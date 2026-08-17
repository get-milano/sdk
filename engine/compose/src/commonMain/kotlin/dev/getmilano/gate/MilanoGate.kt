package dev.getmilano

/**
 * A validated node, post-policy. Deferred expressions remain unevaluated
 * until resolution; placeholder nodes carry their raw subtree for the placeholder
 * renderer.
 */
internal class BuiltNode(
    val type: String,
    val reference: String,
    val isPlaceholder: Boolean,
    val rawSubtree: MilanoValue?,
    val properties: Map<String, DocValue>,
    val children: List<BuiltNode>,
    val events: Map<String, List<ActionSpec>>,
)

/**
 * The construction gate: the five-step validation order from the document
 * model spec. Steps 1 to 4 need only the document and the engine; the
 * builder awaits the state data provider and completes the cross-checks.
 */
internal class MilanoGate(
    private val engine: MilanoEngine,
    private val policy: MilanoUnknownTypePolicy,
    private val viewIdentity: String,
    /**
     * The surface's granted custom actions: the vocabulary's declarations,
     * overridden and narrowed by the builder. Built-in dollar actions are
     * contract, not capabilities.
     */
    private val grantedActions: Map<String, MilanoVocabulary.Action>,
    private val report: (MilanoOccurrence) -> Unit,
) {
    /**
     * Set during the vocabulary walk when any custom action is bound:
     * the builder then requires an action handler.
     */
    var usesCustomActions = false
        private set

    companion object {
        /** The contract majors this runtime supports. */
        val SUPPORTED_MAJORS = listOf(1)

        fun name(type: MilanoType): String {
            val base =
                when (type.kind) {
                    is MilanoType.Kind.Bool -> "bool"
                    is MilanoType.Kind.Int -> "int"
                    is MilanoType.Kind.Double -> "double"
                    is MilanoType.Kind.Text -> "string"
                    is MilanoType.Kind.Enum -> "enum"
                    is MilanoType.Kind.Array -> "array"
                    is MilanoType.Kind.Record -> "record"
                }
            return if (type.optional) "$base?" else base
        }

        fun name(value: MilanoValue): String =
            when (value) {
                is MilanoValue.Null -> "null"
                is MilanoValue.BoolValue -> "bool"
                is MilanoValue.IntValue -> "int"
                is MilanoValue.DoubleValue -> "double"
                is MilanoValue.StringValue -> "string"
                is MilanoValue.ArrayValue -> "array"
                is MilanoValue.RecordValue -> "record"
            }
    }

    /** Steps 1 to 4: parse, version, limits, vocabulary walk. */
    fun validateDocument(
        text: String,
        rawByteCount: Int? = null,
    ): Pair<ParsedDocument, BuiltNode> {
        // Gate limit: document size, checked before parsing; when the host
        // supplied raw bytes their exact count is used.
        val byteCount = rawByteCount ?: text.encodeToByteArray().size
        if (byteCount > engine.limits.maxDocumentBytes) {
            throw MilanoBuildException.LimitExceeded("maxDocumentBytes", engine.limits.maxDocumentBytes, byteCount)
        }

        // Step 1: parse.
        val document = DocumentParser.parse(text)

        // Step 2: version.
        if (document.major !in SUPPORTED_MAJORS) {
            throw MilanoBuildException.UnsupportedVersion(document.versionString, SUPPORTED_MAJORS)
        }

        // Step 3: vocabulary requirement, when the document declares one.
        document.vocabularyRequirement?.let { requirement ->
            if (requirement.name != engine.vocabulary.name) {
                throw MilanoBuildException.SchemaViolation(
                    rule = "vocabulary-requirement",
                    node = null,
                    expected = requirement.name,
                    found = engine.vocabulary.name,
                )
            }
            requirement.min?.let { minimum ->
                val required = parseSemver(minimum)
                val held = parseSemver(engine.vocabulary.version)
                if (required != null && held != null && held < required) {
                    throw MilanoBuildException.SchemaViolation(
                        rule = "vocabulary-requirement",
                        node = null,
                        expected = ">=$minimum",
                        found = engine.vocabulary.version,
                    )
                }
            }
        }

        // Gate limits: depth and node count over the document as written.
        val (depth, count) = measure(document.root, 1)
        if (depth > engine.limits.maxTreeDepth) {
            throw MilanoBuildException.LimitExceeded("maxTreeDepth", engine.limits.maxTreeDepth, depth)
        }
        if (count > engine.limits.maxNodeCount) {
            throw MilanoBuildException.LimitExceeded("maxNodeCount", engine.limits.maxNodeCount, count)
        }

        // Steps 3 and 4: vocabulary walk and expression typing
        // (expression length is checked here too).
        val seenIds = HashSet<String>()
        val root =
            validate(document.root, document, "root", seenIds)
                ?: BuiltNode(
                    // The root itself was an unknown type under the skip policy:
                    // an empty view is still a valid outcome.
                    type = document.root.type,
                    reference = document.root.id ?: "root",
                    isPlaceholder = false,
                    rawSubtree = null,
                    properties = emptyMap(),
                    children = emptyList(),
                    events = emptyMap(),
                )
        return document to root
    }

    /**
     * Step 5, data half: validates supplied context values against the
     * document's declarations. Returns the canonicalized context. Extra
     * supplied keys are ignored: the document reads only what it declares.
     */
    fun validateContext(
        document: ParsedDocument,
        supplied: Map<String, MilanoValue>,
    ): Map<String, MilanoValue> {
        val canonical = LinkedHashMap<String, MilanoValue>()
        for ((key, type) in document.contextDeclarations) {
            val value =
                supplied[key]
                    ?: throw MilanoBuildException.SchemaViolation(rule = "context-declaration", expected = key)
            canonical[key] = type.validated(value)
                ?: throw MilanoBuildException.SchemaViolation(
                    rule = "context-declaration",
                    expected = name(type),
                    found = name(value),
                )
        }
        return canonical
    }

    /** Step 5, state half: validates provider values against declarations. */
    fun validateState(
        document: ParsedDocument,
        provided: Map<String, MilanoValue>,
    ): Map<String, MilanoValue> {
        val canonical = LinkedHashMap<String, MilanoValue>()
        for ((key, type) in document.stateDeclarations) {
            val value = provided[key] ?: MilanoValue.Null
            canonical[key] = type.validated(value)
                ?: throw MilanoBuildException.SchemaViolation(
                    rule = "state-declaration",
                    expected = name(type),
                    found = name(value),
                )
        }
        return canonical
    }

    // Node validation

    private fun validate(
        node: RawNode,
        document: ParsedDocument,
        path: String,
        seenIds: MutableSet<String>,
    ): BuiltNode? {
        val reference = node.id ?: path

        node.id?.let { id ->
            if (!seenIds.add(id)) {
                throw MilanoBuildException.SchemaViolation(
                    rule = "id-uniqueness",
                    node = reference,
                    expected = "unique id",
                    found = id,
                )
            }
        }

        // v1 documents contain no construct nodes at all.
        if (node.type.startsWith("$")) {
            throw MilanoBuildException.SchemaViolation(
                rule = "construct",
                node = reference,
                expected = "component type",
                found = node.type,
            )
        }

        // Unknown component type: detection at the gate, response per policy.
        val component =
            engine.vocabulary.components[node.type]
                ?: return when (policy) {
                    MilanoUnknownTypePolicy.FAIL -> {
                        throw MilanoBuildException.UnknownComponentType(reference, node.type)
                    }

                    MilanoUnknownTypePolicy.SKIP -> {
                        report(
                            MilanoOccurrence(MilanoOccurrence.Kind.UNKNOWN_TYPE_SKIPPED, viewIdentity, reference),
                        )
                        null
                    }

                    MilanoUnknownTypePolicy.PLACEHOLDER -> {
                        report(
                            MilanoOccurrence(MilanoOccurrence.Kind.UNKNOWN_TYPE_PLACEHOLDER, viewIdentity, reference),
                        )
                        BuiltNode(
                            type = node.type,
                            reference = reference,
                            isPlaceholder = true,
                            rawSubtree = node.raw,
                            properties = emptyMap(),
                            children = emptyList(),
                            events = emptyMap(),
                        )
                    }
                }

        // Properties: declared ones type-checked; undeclared ones per strict
        // mode.
        val properties = LinkedHashMap<String, DocValue>()
        for ((name, value) in node.properties) {
            val declaredType = component.properties[name]
            if (declaredType == null) {
                if (component.strict) {
                    throw MilanoBuildException.SchemaViolation(rule = "undeclared-property", node = reference, found = name)
                }
                report(
                    MilanoOccurrence(MilanoOccurrence.Kind.UNDECLARED_PROPERTY, viewIdentity, reference),
                )
                continue
            }
            properties[name] = checked(value, declaredType, "property-type", reference, document)
        }

        // Children acceptance is declared by the vocabulary schema.
        if (node.children.isNotEmpty() && !component.children) {
            throw MilanoBuildException.SchemaViolation(
                rule = "children",
                node = reference,
                expected = "no children",
                found = node.type,
            )
        }

        // Events: bindings against declared events; actions validated with
        // the event's payload type in scope.
        val events = LinkedHashMap<String, List<ActionSpec>>()
        for ((event, actions) in node.events) {
            if (event !in component.events) {
                throw MilanoBuildException.SchemaViolation(
                    rule = "event-binding",
                    node = reference,
                    expected = "declared event",
                    found = event,
                )
            }
            val scope =
                component.events[event]?.let { EventScope.Payload(it) }
                    ?: EventScope.Unavailable
            events[event] = actions.map { validateAction(it, document, reference, scope, EventScope.Unavailable) }
        }

        val children = ArrayList<BuiltNode>()
        for ((index, child) in node.children.withIndex()) {
            validate(child, document, "$path/children[$index]", seenIds)?.let { children.add(it) }
        }

        return BuiltNode(
            type = node.type,
            reference = reference,
            isPlaceholder = false,
            rawSubtree = null,
            properties = properties,
            children = children,
            events = events,
        )
    }

    private fun validateAction(
        action: ActionSpec,
        document: ParsedDocument,
        node: String,
        eventScope: EventScope,
        resultScope: EventScope,
    ): ActionSpec =
        when (action) {
            is ActionSpec.Set -> {
                val stateType =
                    document.stateDeclarations[action.key]
                        ?: throw MilanoBuildException.SchemaViolation(
                            rule = "action-encoding",
                            node = node,
                            expected = "declared state key",
                            found = action.key,
                        )
                ActionSpec.Set(
                    action.key,
                    checked(action.value, stateType, "action-encoding", node, document, eventScope, resultScope),
                )
            }

            is ActionSpec.Sequence -> {
                ActionSpec.Sequence(
                    action.actions.map { validateAction(it, document, node, eventScope, resultScope) },
                )
            }

            is ActionSpec.When -> {
                ActionSpec.When(
                    condition =
                        checked(
                            action.condition,
                            MilanoType(MilanoType.Kind.Bool),
                            "action-encoding",
                            node,
                            document,
                            eventScope,
                            resultScope,
                        ),
                    then = action.then.map { validateAction(it, document, node, eventScope, resultScope) },
                    otherwise = action.otherwise.map { validateAction(it, document, node, eventScope, resultScope) },
                )
            }

            is ActionSpec.Custom -> {
                usesCustomActions = true
                val declaration =
                    grantedActions[action.name]
                        ?: throw MilanoBuildException.SchemaViolation(
                            rule = "action-capability",
                            node = node,
                            expected = "granted action",
                            found = action.name,
                        )
                val checkedParameters = LinkedHashMap<String, DocValue>()
                for ((parameter, value) in action.parameters) {
                    val parameterType =
                        declaration.parameters[parameter]
                            ?: throw MilanoBuildException.SchemaViolation(
                                rule = "action-encoding",
                                node = node,
                                expected = "declared parameter",
                                found = parameter,
                            )
                    checkedParameters[parameter] =
                        checked(value, parameterType, "action-encoding", node, document, eventScope, resultScope)
                }
                for ((parameter, parameterType) in declaration.parameters) {
                    if (parameter !in checkedParameters) {
                        if (!parameterType.optional) {
                            throw MilanoBuildException.SchemaViolation(
                                rule = "action-encoding",
                                node = node,
                                expected = parameter,
                            )
                        }
                        checkedParameters[parameter] = DocValue.Literal(MilanoValue.Null)
                    }
                }
                // Event bindings inside onSuccess/onFailure evaluate against the
                // payload captured at dispatch: same static scope. The result
                // root rebinds to this action's declared result inside
                // onSuccess, and is never available inside onFailure.
                val successScope =
                    declaration.result?.let { EventScope.Payload(it) }
                        ?: EventScope.Unavailable
                ActionSpec.Custom(
                    name = action.name,
                    parameters = checkedParameters,
                    onSuccess =
                        action.onSuccess.map {
                            validateAction(it, document, node, eventScope, successScope)
                        },
                    onFailure =
                        action.onFailure.map {
                            validateAction(it, document, node, eventScope, EventScope.Unavailable)
                        },
                    result = declaration.result,
                )
            }
        }

    /**
     * Type-checks a literal or an expression against the declared type.
     * Expressions are parsed and statically typed here: step 4 of the gate.
     */
    private fun checked(
        value: DocValue,
        type: MilanoType,
        rule: String,
        node: String,
        document: ParsedDocument,
        eventScope: EventScope = EventScope.Unavailable,
        resultScope: EventScope = EventScope.Unavailable,
    ): DocValue =
        when (value) {
            is DocValue.Literal -> {
                val validated =
                    type.validated(value.value)
                        ?: throw MilanoBuildException.SchemaViolation(
                            rule = rule,
                            node = node,
                            expected = name(type),
                            found = name(value.value),
                        )
                DocValue.Literal(validated)
            }

            is DocValue.Expression -> {
                // Counted in Unicode scalars, per the document model's limits.
                val scalarLength = value.source.unicodeScalarCount()
                if (scalarLength > engine.limits.maxExpressionLength) {
                    throw MilanoBuildException.LimitExceeded(
                        "maxExpressionLength",
                        engine.limits.maxExpressionLength,
                        scalarLength,
                    )
                }
                try {
                    val expr = ExprParser.parse(value.source)
                    val checker =
                        ExprChecker(
                            document.stateDeclarations,
                            document.contextDeclarations,
                            eventScope,
                            resultScope,
                        )
                    val inferred = checker.infer(expr, expecting = type)
                    if (!checker.accepts(type, inferred)) throw ExprException("type mismatch")
                    DocValue.TypedExpression(value.source, expr, type)
                } catch (error: ExprException) {
                    throw MilanoBuildException.SchemaViolation(
                        rule = "expression",
                        node = node,
                        expected = name(type),
                        found = error.detail,
                    )
                }
            }

            is DocValue.TypedExpression -> {
                value
            }
        }

    private fun measure(
        node: RawNode,
        depth: Int,
    ): Pair<Int, Int> {
        var maxDepth = depth
        var count = 1
        for (child in node.children) {
            val (childDepth, childCount) = measure(child, depth + 1)
            if (childDepth > maxDepth) maxDepth = childDepth
            count += childCount
        }
        return maxDepth to count
    }
}
