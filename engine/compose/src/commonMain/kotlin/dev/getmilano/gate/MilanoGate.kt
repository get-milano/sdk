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
    /** For a `$repeat`, the template. */
    val children: List<BuiltNode>,
    val events: Map<String, List<ActionSpec>>,
    /** Present exactly when the node is a `$repeat` construct. */
    val repeatSpec: BuiltRepeat? = null,
    /** Present exactly when the node is an `${'$'}if` construct. */
    val conditional: BuiltConditional? = null,
    /** Present exactly when the node is a `${'$'}switch` construct. */
    val choice: BuiltSwitch? = null,
)

/**
 * A validated `${'$'}if`: its typed bool condition and the two branches, each
 * already validated. [otherwise] is empty when the document declared no
 * `else`, which materializes nothing.
 */
internal class BuiltConditional(
    val condition: DocValue,
    val then: List<BuiltNode>,
    val otherwise: List<BuiltNode>,
)

/**
 * Every node a transparent construct's branches hold, or null when the
 * node is not one. `${'$'}repeat` is excluded: its template is `children`, and
 * every walk that cares treats it separately.
 */
internal fun BuiltNode.branchNodes(): List<BuiltNode>? =
    when {
        conditional != null -> conditional.then + conditional.otherwise
        choice != null -> choice.cases.values.flatten() + (choice.fallback ?: emptyList())
        else -> null
    }

/**
 * A validated `${'$'}switch`: its typed enum subject, one validated branch per
 * member the document named, and the branch every other member takes.
 * [fallback] is null when the cases already cover every member.
 */
internal class BuiltSwitch(
    val subject: DocValue,
    val cases: Map<String, List<BuiltNode>>,
    val fallback: List<BuiltNode>?,
)

/**
 * A validated `$repeat`: its typed `items` expression, binding name, and
 * typed `key` expression when it declares one (contract 2.1).
 */
internal class BuiltRepeat(
    val items: DocValue,
    val alias: String,
    val key: DocValue? = null,
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
    /**
     * The surface's declared host functions: the vocabulary's, overridden
     * by the builder's (contract 2.1).
     */
    private val declaredFunctions: Map<String, MilanoVocabulary.Function> = emptyMap(),
    private val report: (MilanoOccurrence) -> Unit,
) {
    /**
     * Set during the vocabulary walk when any custom action is bound:
     * the builder then requires an action handler.
     */
    var usesCustomActions = false
        private set

    /**
     * Every host function the document calls, collected during the walk:
     * the builder then requires a function handler on the engine.
     */
    val usedFunctions: MutableSet<String> = LinkedHashSet()

    companion object {
        // Per contract major, the highest minor this engine implements
        // (Foundations, Versioning). A document's patch never matters.
        val SUPPORTED_VERSIONS: Map<Int, Int> = mapOf(1 to 0, 2 to 1)

        // The supported ranges as the error detail spells them: "1.0", "2.1".
        fun supportedRanges(): List<String> = SUPPORTED_VERSIONS.entries.map { (major, minor) -> "$major.$minor" }

        fun isSupportedVersion(
            major: Int,
            minor: Int,
        ): Boolean = SUPPORTED_VERSIONS[major]?.let { minor <= it } ?: false

        private val RESERVED_ROOTS = setOf("state", "context", "event", "result", "failure")
        private val LIFECYCLE_SIGNALS = setOf("appear", "disappear")

        /**
         * The detail a value mismatch carries (document model spec, rule
         * tables): the declared type against the value's kind, except a
         * string that is not a member of a declared enum, where naming the
         * type would say "enum" and hide which string was rejected.
         */
        fun mismatch(
            type: MilanoType,
            value: MilanoValue,
        ): Pair<String, String> =
            if (type.kind is MilanoType.Kind.Enum && value is MilanoValue.StringValue) {
                "enum member" to value.value
            } else {
                name(type) to name(value)
            }

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

    /** The gate's outcome: the document, the built root, and the lifecycle and watch bindings. */
    class Validated(
        val document: ParsedDocument,
        val root: BuiltNode,
        val lifecycle: Map<String, List<ActionSpec>>,
        val watch: Map<String, List<ActionSpec>> = emptyMap(),
    )

    /**
     * Steps 1 to 4: parse, version, limits, vocabulary walk, then the
     * lifecycle bindings, then the watch bindings.
     */
    fun validateDocument(
        text: String,
        rawByteCount: Int? = null,
    ): Validated {
        // Gate limit: document size, checked before parsing; when the host
        // supplied raw bytes their exact count is used.
        val byteCount = rawByteCount ?: text.encodeToByteArray().size
        if (byteCount > engine.limits.maxDocumentBytes) {
            throw MilanoBuildException.LimitExceeded("maxDocumentBytes", engine.limits.maxDocumentBytes, byteCount)
        }

        // Step 1: parse.
        val document = DocumentParser.parse(text)

        // Step 2: version.
        if (!isSupportedVersion(document.major, document.minor)) {
            throw MilanoBuildException.UnsupportedVersion(document.versionString, supportedRanges())
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
        val built = validate(document.root, document, "root", seenIds)
        // After the tree: the lifecycle bindings (document model spec,
        // Lifecycle bindings).
        val lifecycle = validateLifecycle(document)
        // Then the watch bindings (document model spec, Watch bindings).
        val watch = validateWatch(document)
        val root =
            built
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
        return Validated(document, root, lifecycle, watch)
    }

    /**
     * The document's `watch` section: contract 2.1 only, each key a
     * declared state key, and each action list under the lifecycle rules,
     * with no `event` root and no node to anchor to.
     */
    private fun validateWatch(document: ParsedDocument): Map<String, List<ActionSpec>> {
        if (!document.hasWatch) return emptyMap()
        requireFeature("watch", document, null)
        val watch = LinkedHashMap<String, List<ActionSpec>>()
        for ((key, actions) in document.watch) {
            if (key !in document.stateDeclarations) {
                throw MilanoBuildException.SchemaViolation(
                    rule = "watch",
                    node = null,
                    expected = "declared state key",
                    found = key,
                )
            }
            watch[key] =
                actions.map { validateAction(it, document, null, EventScope.Unavailable, EventScope.Unavailable) }
        }
        return watch
    }

    /**
     * The document's `on` section: contract 2.1 only, the two signal names,
     * and each action list under the event rules with no `event` root and
     * no node to anchor to.
     */
    private fun validateLifecycle(document: ParsedDocument): Map<String, List<ActionSpec>> {
        if (!document.hasLifecycle) return emptyMap()
        requireFeature("on", document, null)
        val lifecycle = LinkedHashMap<String, List<ActionSpec>>()
        for ((signal, actions) in document.lifecycle) {
            if (signal !in LIFECYCLE_SIGNALS) {
                throw MilanoBuildException.SchemaViolation(
                    rule = "event-binding",
                    node = null,
                    expected = "lifecycle event",
                    found = signal,
                )
            }
            lifecycle[signal] =
                actions.map { validateAction(it, document, null, EventScope.Unavailable, EventScope.Unavailable) }
        }
        return lifecycle
    }

    /**
     * A feature the document's declared minor does not have yet is the
     * `contract-feature` violation, named after the feature (document
     * model spec, Validation).
     */
    private fun requireFeature(
        name: String,
        document: ParsedDocument,
        node: String?,
        // The feature's key and the name a report carries are usually the
        // same; `${'$'}ifConstruct` is keyed apart from the `${'$'}if` function and
        // reports as `${'$'}if`.
        found: String = name,
    ) {
        if (!MilanoContractFeatures.has(name, document.major, document.minor)) {
            throw MilanoBuildException.SchemaViolation(
                rule = "contract-feature",
                node = node,
                expected = MilanoContractFeatures.versionOf(name),
                found = found,
            )
        }
    }

    /** An expression checker for this document's contract and the given scopes. */
    private fun checker(
        document: ParsedDocument,
        eventScope: EventScope,
        resultScope: EventScope,
        failureScope: EventScope,
        bindings: Map<String, MilanoType>,
    ): ExprChecker =
        ExprChecker(
            document.stateDeclarations,
            document.contextDeclarations,
            eventScope,
            resultScope,
            bindings,
            failureScope,
            document.major to document.minor,
            declaredFunctions,
            usedFunctions,
        )

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
            val validated =
                type.validated(value)
                    ?: mismatch(type, value).let { (expected, found) ->
                        throw MilanoBuildException.SchemaViolation(
                            rule = "context-declaration",
                            expected = expected,
                            found = found,
                        )
                    }
            checkValueSize(validated)
            canonical[key] = validated
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
            val validated =
                type.validated(value)
                    ?: mismatch(type, value).let { (expected, found) ->
                        throw MilanoBuildException.SchemaViolation(
                            rule = "state-declaration",
                            expected = expected,
                            found = found,
                        )
                    }
            checkValueSize(validated)
            canonical[key] = validated
        }
        return canonical
    }

    /** A value entering state or context fits the value size limit. */
    private fun checkValueSize(value: MilanoValue) {
        val size = value.size
        if (size > engine.limits.maxValueSize) {
            throw MilanoBuildException.LimitExceeded("maxValueSize", engine.limits.maxValueSize, size)
        }
    }

    // Node validation

    private fun validate(
        node: RawNode,
        document: ParsedDocument,
        path: String,
        seenIds: MutableSet<String>,
        bindings: Map<String, MilanoType> = emptyMap(),
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

        // Constructs live in the `$` namespace; contract 2.0 admits `$repeat`.
        if (node.type.startsWith("$")) {
            if (node.type == "\$repeat" && document.major >= 2) {
                return validateRepeat(node, document, path, reference, seenIds, bindings)
            }
            if (node.type == "\$switch" && document.major >= 2) {
                requireFeature("\$switchConstruct", document, reference, "\$switch")
                return validateSwitch(node, document, path, reference, seenIds, bindings)
            }
            if (node.type == "\$if" && document.major >= 2) {
                requireFeature("\$ifConstruct", document, reference, "\$if")
                return validateConditional(node, document, path, reference, seenIds, bindings)
            }
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
                            MilanoOccurrence(
                                MilanoOccurrence.Kind.UNKNOWN_TYPE_SKIPPED,
                                viewIdentity,
                                reference,
                                name = node.type,
                            ),
                        )
                        null
                    }

                    MilanoUnknownTypePolicy.PLACEHOLDER -> {
                        report(
                            MilanoOccurrence(
                                MilanoOccurrence.Kind.UNKNOWN_TYPE_PLACEHOLDER,
                                viewIdentity,
                                reference,
                                name = node.type,
                            ),
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
                    MilanoOccurrence(MilanoOccurrence.Kind.UNDECLARED_PROPERTY, viewIdentity, reference, name = name),
                )
                continue
            }
            properties[name] = checked(value, declaredType, "property-type", reference, document, bindings = bindings)
        }

        // Children acceptance is declared by the vocabulary schema.
        if (node.children.isNotEmpty() && !component.children) {
            throw MilanoBuildException.SchemaViolation(
                rule = "children",
                node = reference,
                expected = "no children",
                found = "children",
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
            events[event] = actions.map { validateAction(it, document, reference, scope, EventScope.Unavailable, bindings) }
        }

        val children = ArrayList<BuiltNode>()
        for ((index, child) in node.children.withIndex()) {
            validate(child, document, "$path/children[$index]", seenIds, bindings)?.let { children.add(it) }
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

    /**
     * The `${'$'}switch` construct (document model spec, Constructs): an enum
     * subject and one branch per member, or a `default` for the rest. A
     * member that neither covers is the whole point: the gate says so
     * rather than the view rendering nothing.
     */
    private fun validateSwitch(
        node: RawNode,
        document: ParsedDocument,
        path: String,
        reference: String,
        seenIds: MutableSet<String>,
        bindings: Map<String, MilanoType>,
    ): BuiltNode {
        fun violation(
            expected: String,
            found: String?,
        ) = MilanoBuildException.SchemaViolation(
            rule = "switch",
            node = reference,
            expected = expected,
            found = found,
        )
        if (path == "root") throw violation("not the root", "root")
        if (node.properties.isNotEmpty()) throw violation("no properties", "properties")
        if (node.events.isNotEmpty()) throw violation("no on", "on")
        node.id?.let { throw violation("no id", it) }
        val spec = node.switchSpec ?: throw violation("subject expression", null)
        spec.undeclared.firstOrNull()?.let { throw violation("declared key", it) }
        val subject = spec.subject ?: throw violation("subject expression", null)
        if (subject is DocValue.Literal) throw violation("subject expression", name(subject.value))
        val cases = spec.cases ?: throw violation("cases", null)
        if (cases.isEmpty()) throw violation("cases", "empty")

        val source = (subject as? DocValue.Expression)?.source ?: throw violation("subject expression", null)
        val scalarLength = source.unicodeScalarCount()
        if (scalarLength > engine.limits.maxExpressionLength) {
            throw MilanoBuildException.LimitExceeded(
                "maxExpressionLength",
                engine.limits.maxExpressionLength,
                scalarLength,
            )
        }
        val expr: Expr
        val subjectType: MilanoType?
        try {
            expr = ExprParser.parse(source)
            subjectType =
                checker(document, EventScope.Unavailable, EventScope.Unavailable, EventScope.Unavailable, bindings)
                    .infer(expr)
        } catch (error: ExprFeatureException) {
            throw MilanoBuildException.SchemaViolation(
                rule = "contract-feature",
                node = reference,
                expected = error.version,
                found = error.feature,
            )
        } catch (_: ExprException) {
            throw MilanoBuildException.SchemaViolation(
                rule = "expression",
                node = reference,
                expected = "enum",
                found = null,
            )
        }
        val members = (subjectType?.kind as? MilanoType.Kind.Enum)?.members
        if (subjectType == null || members == null || subjectType.optional) {
            throw violation("enum subject", subjectType?.let { name(it) } ?: "null")
        }

        fun branch(
            nodes: List<RawNode>,
            where: String,
        ): List<BuiltNode> {
            val built = ArrayList<BuiltNode>()
            for ((index, child) in nodes.withIndex()) {
                validate(child, document, "$path/$where[$index]", seenIds, bindings)?.let { built.add(it) }
            }
            return built
        }

        val built = LinkedHashMap<String, List<BuiltNode>>()
        for ((member, nodes) in cases) {
            if (member !in members) throw violation("declared member", member)
            if (nodes.isEmpty()) throw violation("case branch", "empty")
            built[member] = branch(nodes, "cases[$member]")
        }
        if (spec.hasFallback && spec.fallback.isNullOrEmpty()) {
            throw violation("default branch", "empty")
        }
        if (!spec.hasFallback) {
            // Exhaustive without one: every member is covered, so no
            // value of the subject can reach a branch that is not there.
            members.sorted().firstOrNull { it !in cases }?.let {
                throw violation("every member or a default", it)
            }
        }

        return BuiltNode(
            type = node.type,
            reference = reference,
            isPlaceholder = false,
            rawSubtree = null,
            properties = emptyMap(),
            children = emptyList(),
            events = emptyMap(),
            choice =
                BuiltSwitch(
                    subject = DocValue.TypedExpression(source, expr, subjectType),
                    cases = built,
                    fallback = spec.fallback?.let { branch(it, "default") },
                ),
        )
    }

    /**
     * The `${'$'}if` construct (document model spec, Constructs): never the
     * root, no properties, bindings, or id, a bool expression as the
     * condition, and both branches validated, so a defect in the branch a
     * build does not take still fails that build.
     */
    private fun validateConditional(
        node: RawNode,
        document: ParsedDocument,
        path: String,
        reference: String,
        seenIds: MutableSet<String>,
        bindings: Map<String, MilanoType>,
    ): BuiltNode {
        fun violation(
            expected: String,
            found: String?,
        ) = MilanoBuildException.SchemaViolation(
            rule = "conditional",
            node = reference,
            expected = expected,
            found = found,
        )
        if (path == "root") throw violation("not the root", "root")
        if (node.properties.isNotEmpty()) throw violation("no properties", "properties")
        if (node.events.isNotEmpty()) throw violation("no on", "on")
        node.id?.let { throw violation("no id", it) }
        val spec = node.conditionalSpec ?: throw violation("condition expression", null)
        spec.undeclared.firstOrNull()?.let { throw violation("declared key", it) }
        val condition = spec.condition ?: throw violation("condition expression", null)
        if (condition is DocValue.Literal) throw violation("condition expression", name(condition.value))
        val then = spec.then ?: throw violation("then branch", null)
        if (then.isEmpty()) throw violation("then branch", "empty")
        if (spec.otherwise != null && spec.otherwise.isEmpty()) throw violation("else branch", "empty")

        val source = (condition as? DocValue.Expression)?.source ?: throw violation("condition expression", null)
        val scalarLength = source.unicodeScalarCount()
        if (scalarLength > engine.limits.maxExpressionLength) {
            throw MilanoBuildException.LimitExceeded(
                "maxExpressionLength",
                engine.limits.maxExpressionLength,
                scalarLength,
            )
        }
        val expr: Expr
        val conditionType: MilanoType?
        try {
            expr = ExprParser.parse(source)
            conditionType =
                checker(document, EventScope.Unavailable, EventScope.Unavailable, EventScope.Unavailable, bindings)
                    .infer(expr)
        } catch (error: ExprFeatureException) {
            throw MilanoBuildException.SchemaViolation(
                rule = "contract-feature",
                node = reference,
                expected = error.version,
                found = error.feature,
            )
        } catch (_: ExprException) {
            throw MilanoBuildException.SchemaViolation(
                rule = "expression",
                node = reference,
                expected = "bool",
                found = null,
            )
        }
        if (conditionType == null || conditionType.kind !is MilanoType.Kind.Bool || conditionType.optional) {
            throw violation("bool condition", conditionType?.let { name(it) } ?: "null")
        }

        // Both branches are part of the document, so both are validated
        // and ids stay unique across them.
        fun branch(
            nodes: List<RawNode>,
            name: String,
        ): List<BuiltNode> {
            val built = ArrayList<BuiltNode>()
            for ((index, child) in nodes.withIndex()) {
                validate(child, document, "$path/$name[$index]", seenIds, bindings)?.let { built.add(it) }
            }
            return built
        }

        return BuiltNode(
            type = node.type,
            reference = reference,
            isPlaceholder = false,
            rawSubtree = null,
            properties = emptyMap(),
            children = emptyList(),
            events = emptyMap(),
            conditional =
                BuiltConditional(
                    condition = DocValue.TypedExpression(source, expr, conditionType),
                    then = branch(then, "then"),
                    otherwise = spec.otherwise?.let { branch(it, "else") } ?: emptyList(),
                ),
        )
    }

    /**
     * The `$repeat` construct (document model spec, Constructs): never the
     * root, no properties or bindings, an array expression as `items`, a
     * fresh identifier as `as`, and a template validated with the element
     * and its index in scope.
     */
    private fun validateRepeat(
        node: RawNode,
        document: ParsedDocument,
        path: String,
        reference: String,
        seenIds: MutableSet<String>,
        bindings: Map<String, MilanoType>,
    ): BuiltNode {
        fun violation(
            expected: String,
            found: String?,
        ) = MilanoBuildException.SchemaViolation(rule = "repeat", node = reference, expected = expected, found = found)
        if (path == "root") throw violation("child position", "root")
        if (node.properties.isNotEmpty()) throw violation("items, as, children", "properties")
        if (node.events.isNotEmpty()) throw violation("items, as, children", "on")
        val spec = node.repeatSpec
        val items = spec?.items ?: throw violation("items expression", null)
        if (items is DocValue.Literal) throw violation("items expression", name(items.value))
        val alias = spec.alias
        if (alias == null || !MilanoIdentifier.isValid(alias) || alias in RESERVED_ROOTS) {
            throw violation("binding identifier", alias)
        }
        if (alias in bindings || "${alias}_index" in bindings) throw violation("distinct binding", alias)
        if (node.children.isEmpty()) throw violation("template", "no children")

        // items: an expression typing to a non-optional array, in the
        // enclosing bindings' scope.
        val source = (items as? DocValue.Expression)?.source ?: throw violation("items expression", null)
        val scalarLength = source.unicodeScalarCount()
        if (scalarLength > engine.limits.maxExpressionLength) {
            throw MilanoBuildException.LimitExceeded("maxExpressionLength", engine.limits.maxExpressionLength, scalarLength)
        }
        val expr: Expr
        val itemsType: MilanoType?
        try {
            expr = ExprParser.parse(source)
            itemsType =
                checker(document, EventScope.Unavailable, EventScope.Unavailable, EventScope.Unavailable, bindings)
                    .infer(expr)
        } catch (error: ExprFeatureException) {
            throw MilanoBuildException.SchemaViolation(
                rule = "contract-feature",
                node = reference,
                expected = error.version,
                found = error.feature,
            )
        } catch (_: ExprException) {
            throw MilanoBuildException.SchemaViolation(rule = "expression", node = reference, expected = "array", found = null)
        }
        val element = (itemsType?.kind as? MilanoType.Kind.Array)?.element
        if (itemsType == null || element == null || itemsType.optional) {
            throw violation("array items", itemsType?.let { name(it) } ?: "null")
        }

        val inner = bindings + (alias to element) + ("${alias}_index" to MilanoType(MilanoType.Kind.Int))

        // key (contract 2.1): an expression over the template's roots whose
        // type is a non-optional string, int, or enum; checked after the
        // items type and before the template's nodes.
        val key = spec.key?.let { keySpec -> validateKey(keySpec, document, reference, inner, ::violation) }

        val template = ArrayList<BuiltNode>()
        for ((index, child) in node.children.withIndex()) {
            validate(child, document, "$path/children[$index]", seenIds, inner)?.let { template.add(it) }
        }
        return BuiltNode(
            type = node.type,
            reference = reference,
            isPlaceholder = false,
            rawSubtree = null,
            properties = emptyMap(),
            children = template,
            events = emptyMap(),
            repeatSpec = BuiltRepeat(DocValue.TypedExpression(source, expr, itemsType), alias, key),
        )
    }

    private fun validateKey(
        keySpec: DocValue,
        document: ParsedDocument,
        reference: String,
        bindings: Map<String, MilanoType>,
        violation: (String, String?) -> MilanoBuildException,
    ): DocValue {
        requireFeature("key", document, reference)
        if (keySpec is DocValue.Literal) throw violation("key expression", name(keySpec.value))
        val source = (keySpec as? DocValue.Expression)?.source ?: throw violation("key expression", null)
        val scalarLength = source.unicodeScalarCount()
        if (scalarLength > engine.limits.maxExpressionLength) {
            throw MilanoBuildException.LimitExceeded("maxExpressionLength", engine.limits.maxExpressionLength, scalarLength)
        }
        val expr: Expr
        val keyType: MilanoType?
        try {
            expr = ExprParser.parse(source)
            keyType =
                checker(document, EventScope.Unavailable, EventScope.Unavailable, EventScope.Unavailable, bindings)
                    .infer(expr)
        } catch (error: ExprFeatureException) {
            throw MilanoBuildException.SchemaViolation(
                rule = "contract-feature",
                node = reference,
                expected = error.version,
                found = error.feature,
            )
        } catch (_: ExprException) {
            throw MilanoBuildException.SchemaViolation(
                rule = "expression",
                node = reference,
                expected = "string or int",
                found = null,
            )
        }
        val scalarKey =
            when (keyType?.kind) {
                is MilanoType.Kind.Text, is MilanoType.Kind.Int, is MilanoType.Kind.Enum -> true
                else -> false
            }
        if (keyType == null || keyType.optional || !scalarKey) {
            throw violation("key type", keyType?.let { name(it) } ?: "null")
        }
        return DocValue.TypedExpression(source, expr, keyType)
    }

    private fun validateAction(
        action: ActionSpec,
        document: ParsedDocument,
        node: String?,
        eventScope: EventScope,
        resultScope: EventScope,
        bindings: Map<String, MilanoType> = emptyMap(),
        failureScope: EventScope = EventScope.Unavailable,
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
                    checked(
                        action.value,
                        stateType,
                        "action-encoding",
                        node,
                        document,
                        eventScope,
                        resultScope,
                        bindings,
                        failureScope,
                    ),
                )
            }

            is ActionSpec.ArrayAction -> {
                validateArrayAction(action, document, node, eventScope, resultScope, bindings, failureScope)
            }

            // Already validated: the gate never sees these before it made them.
            is ActionSpec.Append, is ActionSpec.Remove, is ActionSpec.Update -> {
                action
            }

            is ActionSpec.Sequence -> {
                ActionSpec.Sequence(
                    action.actions.map {
                        validateAction(it, document, node, eventScope, resultScope, bindings, failureScope)
                    },
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
                            bindings,
                            failureScope,
                        ),
                    then =
                        action.then.map {
                            validateAction(it, document, node, eventScope, resultScope, bindings, failureScope)
                        },
                    otherwise =
                        action.otherwise.map {
                            validateAction(it, document, node, eventScope, resultScope, bindings, failureScope)
                        },
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
                        checked(
                            value,
                            parameterType,
                            "action-encoding",
                            node,
                            document,
                            eventScope,
                            resultScope,
                            bindings,
                            failureScope,
                        )
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
                // onSuccess, and the failure root to its declared failure
                // payload inside onFailure; neither is available in the other.
                val successScope =
                    declaration.result?.let { EventScope.Payload(it) }
                        ?: EventScope.Unavailable
                val failedScope =
                    declaration.failure?.let { EventScope.Payload(it) }
                        ?: EventScope.Unavailable
                ActionSpec.Custom(
                    name = action.name,
                    parameters = checkedParameters,
                    onSuccess =
                        action.onSuccess.map {
                            validateAction(it, document, node, eventScope, successScope, bindings, EventScope.Unavailable)
                        },
                    onFailure =
                        action.onFailure.map {
                            validateAction(it, document, node, eventScope, EventScope.Unavailable, bindings, failedScope)
                        },
                    result = declaration.result,
                    failure = declaration.failure,
                )
            }
        }

    /**
     * An array action's encoding (document model spec, Actions): the target
     * a declared, non-optional array key (records for `$update`), no
     * undeclared parameter, every parameter present, `at` an int, `field` a
     * declared field, `value` typed as the element or the field; each rule
     * an `action-encoding` violation, in the order the spec fixes. A
     * document declaring 2.0 may not carry one at all.
     */
    private fun validateArrayAction(
        action: ActionSpec.ArrayAction,
        document: ParsedDocument,
        node: String?,
        eventScope: EventScope,
        resultScope: EventScope,
        bindings: Map<String, MilanoType>,
        failureScope: EventScope,
    ): ActionSpec {
        requireFeature(action.name, document, node)

        fun violation(
            expected: String?,
            found: String?,
        ) = MilanoBuildException.SchemaViolation(rule = "action-encoding", node = node, expected = expected, found = found)
        val key = action.key
        val declared = key?.let { document.stateDeclarations[it] } ?: throw violation("declared state key", key)
        val element = (declared.kind as? MilanoType.Kind.Array)?.element
        if (element == null || declared.optional) throw violation("array state key", key)
        val fields = (element.kind as? MilanoType.Kind.Record)?.fields?.takeUnless { element.optional }
        if (action.name == "\$update" && fields == null) throw violation("record element", key)
        action.extra.firstOrNull()?.let { throw violation("declared parameter", it) }
        for (parameter in ActionSpec.ArrayAction.PARAMETERS.getValue(action.name)) {
            val present =
                when (parameter) {
                    "at" -> action.at != null
                    "field" -> action.field != null || action.fieldFound != null
                    "value" -> action.value != null
                    else -> true
                }
            if (!present) throw violation(parameter, null)
        }

        fun check(
            value: DocValue,
            type: MilanoType,
        ) = checked(value, type, "action-encoding", node, document, eventScope, resultScope, bindings, failureScope)
        val at = action.at?.let { check(it, MilanoType(MilanoType.Kind.Int)) }
        return when (action.name) {
            "\$update" -> {
                val field = action.field
                val fieldType = field?.let { fields?.get(it) } ?: throw violation("declared field", field ?: action.fieldFound)
                ActionSpec.Update(key, requireNotNull(at), field, check(requireNotNull(action.value), fieldType))
            }

            "\$remove" -> {
                ActionSpec.Remove(key, requireNotNull(at))
            }

            else -> {
                ActionSpec.Append(key, check(requireNotNull(action.value), element))
            }
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
        node: String?,
        document: ParsedDocument,
        eventScope: EventScope = EventScope.Unavailable,
        resultScope: EventScope = EventScope.Unavailable,
        bindings: Map<String, MilanoType> = emptyMap(),
        failureScope: EventScope = EventScope.Unavailable,
    ): DocValue =
        when (value) {
            is DocValue.Literal -> {
                val validated =
                    type.validated(value.value)
                        ?: mismatch(type, value.value).let { (expected, found) ->
                            throw MilanoBuildException.SchemaViolation(
                                rule = rule,
                                node = node,
                                expected = expected,
                                found = found,
                            )
                        }
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
                    val checker = checker(document, eventScope, resultScope, failureScope, bindings)
                    val inferred = checker.infer(expr, expecting = type)
                    if (!checker.accepts(type, inferred)) throw ExprException("type mismatch")
                    DocValue.TypedExpression(value.source, expr, type)
                } catch (error: ExprFeatureException) {
                    // A function or root from a later minor than the document
                    // declares: the contract-feature rule, named after the feature.
                    throw MilanoBuildException.SchemaViolation(
                        rule = "contract-feature",
                        node = node,
                        expected = error.version,
                        found = error.feature,
                    )
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
        // A construct's branches are part of the document even though
        // only one materializes, so the limits see them.
        val cases = node.switchSpec?.cases ?: emptyMap()
        val children =
            node.children +
                (node.conditionalSpec?.then ?: emptyList()) +
                (node.conditionalSpec?.otherwise ?: emptyList()) +
                cases.values.flatten() +
                (node.switchSpec?.fallback ?: emptyList())
        for (child in children) {
            val (childDepth, childCount) = measure(child, depth + 1)
            if (childDepth > maxDepth) maxDepth = childDepth
            count += childCount
        }
        return maxDepth to count
    }
}
