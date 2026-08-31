package dev.getmilano

import kotlinx.serialization.json.Json

internal object DocumentParser {
    /** Step 1 of the gate: parse. Envelope violations are MalformedDocument. */
    fun parse(text: String): ParsedDocument {
        val rootValue =
            try {
                MilanoValue.fromJson(Json.parseToJsonElement(text))
            } catch (_: Exception) {
                throw MilanoBuildException.MalformedDocument("not well-formed JSON")
            }
        val root =
            (rootValue as? MilanoValue.RecordValue)?.values
                ?: throw MilanoBuildException.MalformedDocument("document is not an object")

        val versionString =
            (root["version"] as? MilanoValue.StringValue)?.value
                ?: throw MilanoBuildException.MalformedDocument("missing version")
        val parts = versionString.split(".")
        val major = parts.getOrNull(0)?.toIntOrNull()
        val minor = parts.getOrNull(1)?.toIntOrNull()
        val patch = parts.getOrNull(2)?.toIntOrNull()
        if (parts.size != 3 || major == null || minor == null || patch == null ||
            major < 0 || minor < 0 || patch < 0
        ) {
            throw MilanoBuildException.MalformedDocument("version is not major.minor.patch")
        }

        val vocabularyRequirement =
            root["vocabulary"]?.let { entry ->
                val requirement =
                    (entry as? MilanoValue.RecordValue)?.values
                        ?: throw MilanoBuildException.MalformedDocument("vocabulary requirement is not an object")
                val requiredName =
                    (requirement["name"] as? MilanoValue.StringValue)?.value?.takeIf { it.isNotEmpty() }
                        ?: throw MilanoBuildException.MalformedDocument("vocabulary requirement needs a name")
                val minimum =
                    requirement["min"]?.let { minEntry ->
                        (minEntry as? MilanoValue.StringValue)?.value?.takeIf { parseSemver(it) != null }
                            ?: throw MilanoBuildException.MalformedDocument("vocabulary min is not major.minor.patch")
                    }
                VocabularyRequirement(requiredName, minimum)
            }

        val contextDeclarations = declarations(root["context"], "context")
        val stateDeclarations = declarations(root["state"], "state")

        val rootNodeEntry =
            root["root"]
                ?: throw MilanoBuildException.MalformedDocument("missing root")
        val rootNode = node(rootNodeEntry, "root")
        // metadata is a JSON object: hosts read it as a map.
        root["metadata"]?.let { metadata ->
            if (metadata !is MilanoValue.RecordValue) {
                throw MilanoBuildException.MalformedDocument("metadata must be an object")
            }
        }

        // Lifecycle bindings: a map of signal name to actions, like a node's on.
        val lifecycle = LinkedHashMap<String, List<ActionSpec>>()
        when (val onEntry = root["on"]) {
            null -> {}

            is MilanoValue.RecordValue -> {
                for ((signal, actionsEntry) in onEntry.values.entries.sortedBy { it.key }) {
                    lifecycle[signal] = actionList(actionsEntry, "on.$signal")
                }
            }

            else -> {
                throw MilanoBuildException.MalformedDocument("on is not an object")
            }
        }

        // Watch bindings: a map of state key to actions, like a node's on.
        val watch = LinkedHashMap<String, List<ActionSpec>>()
        when (val watchEntry = root["watch"]) {
            null -> {}

            is MilanoValue.RecordValue -> {
                for ((key, actionsEntry) in watchEntry.values.entries.sortedBy { it.key }) {
                    watch[key] = actionList(actionsEntry, "watch.$key")
                }
            }

            else -> {
                throw MilanoBuildException.MalformedDocument("watch is not an object")
            }
        }

        return ParsedDocument(
            versionString,
            major,
            minor,
            vocabularyRequirement,
            contextDeclarations,
            stateDeclarations,
            rootNode,
            root["metadata"],
            lifecycle,
            root["on"] != null,
            watch,
            root["watch"] != null,
        )
    }

    private fun declarations(
        entry: MilanoValue?,
        section: String,
    ): Map<String, MilanoType> {
        if (entry == null) return emptyMap()
        val obj =
            (entry as? MilanoValue.RecordValue)?.values
                ?: throw MilanoBuildException.MalformedDocument("$section is not an object")
        val result = LinkedHashMap<String, MilanoType>(obj.size)
        // Object members in lexicographic key order (document model spec,
        // Validation): JSON defines no order for them.
        for ((key, descriptor) in obj.entries.sortedBy { it.key }) {
            // A key that is not an identifier and a descriptor the contract
            // does not define are different defects, and the detail says which.
            if (!MilanoIdentifier.isValid(key)) {
                throw MilanoBuildException.SchemaViolation(
                    rule = "$section-declaration",
                    expected = "identifier",
                    found = key,
                )
            }
            val type =
                MilanoType.fromDescriptor(descriptor)
                    ?: throw MilanoBuildException.SchemaViolation(
                        rule = "$section-declaration",
                        expected = "type descriptor",
                        found = key,
                    )
            result[key] = type
        }
        return result
    }

    private fun node(
        entry: MilanoValue,
        path: String,
    ): RawNode {
        val obj =
            (entry as? MilanoValue.RecordValue)?.values
                ?: throw MilanoBuildException.MalformedDocument("$path is not an object")
        val type =
            (obj["type"] as? MilanoValue.StringValue)?.value
                ?: throw MilanoBuildException.MalformedDocument("$path has no type")

        val id =
            when (val idEntry = obj["id"]) {
                null -> {
                    null
                }

                // An empty id would be an empty reference in every report
                // about the node; the envelope requires a non-empty string.
                is MilanoValue.StringValue -> {
                    idEntry.value.ifEmpty { throw MilanoBuildException.MalformedDocument("$path id is empty") }
                }

                else -> {
                    throw MilanoBuildException.MalformedDocument("$path id is not a string")
                }
            }

        val properties = LinkedHashMap<String, DocValue>()
        when (val propertiesEntry = obj["properties"]) {
            null -> {}

            is MilanoValue.RecordValue -> {
                for ((name, value) in propertiesEntry.values.entries.sortedBy { it.key }) {
                    properties[name] = docValue(value, "$path.$name")
                }
            }

            else -> {
                throw MilanoBuildException.MalformedDocument("$path properties is not an object")
            }
        }

        val children = ArrayList<RawNode>()
        when (val childrenEntry = obj["children"]) {
            null -> {}

            is MilanoValue.ArrayValue -> {
                for ((index, child) in childrenEntry.values.withIndex()) {
                    children.add(node(child, "$path/children[$index]"))
                }
            }

            else -> {
                throw MilanoBuildException.MalformedDocument("$path children is not an array")
            }
        }

        val events = LinkedHashMap<String, List<ActionSpec>>()
        when (val onEntry = obj["on"]) {
            null -> {}

            is MilanoValue.RecordValue -> {
                for ((event, actionsEntry) in onEntry.values.entries.sortedBy { it.key }) {
                    events[event] = actionList(actionsEntry, "$path.on.$event")
                }
            }

            else -> {
                throw MilanoBuildException.MalformedDocument("$path on is not an object")
            }
        }

        // The construct's own keys travel as parsed; the gate applies its rules.
        val repeatSpec =
            if (type == "\$repeat") {
                RepeatSpec(
                    items = obj["items"]?.let { docValue(it, "$path.items") },
                    alias = (obj["as"] as? MilanoValue.StringValue)?.value,
                    key = obj["key"]?.let { docValue(it, "$path.key") },
                )
            } else {
                null
            }

        val conditionalSpec =
            if (type == "\$if") {
                fun branch(name: String): List<RawNode>? =
                    when (val list = obj[name]) {
                        null -> {
                            null
                        }

                        is MilanoValue.ArrayValue -> {
                            list.values.mapIndexed { index, child ->
                                node(child, "$path/$name[$index]")
                            }
                        }

                        else -> {
                            throw MilanoBuildException.MalformedDocument(
                                "$path $name is not an array",
                            )
                        }
                    }
                val declared = setOf("type", "condition", "then", "else")
                ConditionalSpec(
                    condition = obj["condition"]?.let { docValue(it, "$path.condition") },
                    then = branch("then"),
                    otherwise = branch("else"),
                    undeclared = obj.keys.filterNot { it in declared }.sorted(),
                )
            } else {
                null
            }

        val switchSpec =
            if (type == "\$switch") {
                fun nodeList(
                    value: MilanoValue,
                    where: String,
                ): List<RawNode> =
                    when (value) {
                        is MilanoValue.ArrayValue -> {
                            value.values.mapIndexed { index, child ->
                                node(child, "$path/$where[$index]")
                            }
                        }

                        else -> {
                            throw MilanoBuildException.MalformedDocument(
                                "$path $where is not an array",
                            )
                        }
                    }

                val casesEntry = obj["cases"]
                val cases =
                    when (casesEntry) {
                        null -> {
                            null
                        }

                        is MilanoValue.RecordValue -> {
                            casesEntry.values.entries.sortedBy { it.key }.associate { (member, branch) ->
                                member to nodeList(branch, "cases[$member]")
                            }
                        }

                        else -> {
                            throw MilanoBuildException.MalformedDocument(
                                "$path cases is not an object",
                            )
                        }
                    }
                val fallbackEntry = obj["default"]
                val declared = setOf("type", "subject", "cases", "default")
                SwitchSpec(
                    subject = obj["subject"]?.let { docValue(it, "$path.subject") },
                    cases = cases,
                    fallback = fallbackEntry?.let { nodeList(it, "default") },
                    hasFallback = fallbackEntry != null,
                    undeclared = obj.keys.filterNot { it in declared }.sorted(),
                )
            } else {
                null
            }

        return RawNode(
            type,
            id,
            properties,
            children,
            events,
            entry,
            repeatSpec,
            conditionalSpec,
            switchSpec,
        )
    }

    /**
     * A value is dynamic only when written as the reserved single-key
     * `$expr` wrapper. An object mixing `$expr` with other keys is invalid.
     */
    private fun docValue(
        entry: MilanoValue,
        path: String,
    ): DocValue {
        if (entry is MilanoValue.RecordValue && "\$expr" in entry.values) {
            val source = (entry.values["\$expr"] as? MilanoValue.StringValue)?.value
            if (entry.values.size != 1 || source == null) {
                throw MilanoBuildException.MalformedDocument("$path invalid \$expr wrapper")
            }
            return DocValue.Expression(source)
        }
        return DocValue.Literal(entry)
    }

    private fun actionList(
        entry: MilanoValue,
        path: String,
    ): List<ActionSpec> =
        when (entry) {
            is MilanoValue.ArrayValue -> {
                entry.values.mapIndexed { index, item -> action(item, "$path[$index]") }
            }

            is MilanoValue.RecordValue -> {
                listOf(action(entry, path))
            }

            else -> {
                throw MilanoBuildException.MalformedDocument("$path is not an action or action list")
            }
        }

    private fun action(
        entry: MilanoValue,
        path: String,
    ): ActionSpec {
        val obj =
            (entry as? MilanoValue.RecordValue)?.values
                ?: throw MilanoBuildException.MalformedDocument("$path is not an object")
        val name =
            (obj["action"] as? MilanoValue.StringValue)?.value
                ?: throw MilanoBuildException.SchemaViolation(rule = "action-encoding", expected = "action key", found = path)

        return when (name) {
            "\$set" -> {
                val key = (obj["key"] as? MilanoValue.StringValue)?.value
                val valueEntry = obj["value"]
                if (!obj.keys.all { it in setOf("action", "key", "value") } || key == null || valueEntry == null) {
                    throw MilanoBuildException.SchemaViolation(
                        rule = "action-encoding",
                        expected = "\$set key and value",
                        found = path,
                    )
                }
                ActionSpec.Set(key, docValue(valueEntry, "$path.value"))
            }

            "\$sequence" -> {
                val actionsEntry = obj["actions"]
                if (!obj.keys.all { it in setOf("action", "actions") } || actionsEntry !is MilanoValue.ArrayValue) {
                    throw MilanoBuildException.SchemaViolation(
                        rule = "action-encoding",
                        expected = "\$sequence actions",
                        found = path,
                    )
                }
                ActionSpec.Sequence(actionList(actionsEntry, "$path.actions"))
            }

            "\$when" -> {
                // Both branches are optional: a $when may carry only `else`.
                val conditionEntry = obj["condition"]
                if (!obj.keys.all { it in setOf("action", "condition", "then", "else") } ||
                    conditionEntry == null
                ) {
                    throw MilanoBuildException.SchemaViolation(
                        rule = "action-encoding",
                        expected = "\$when condition",
                        found = path,
                    )
                }
                ActionSpec.When(
                    condition = docValue(conditionEntry, "$path.condition"),
                    then = obj["then"]?.let { actionList(it, "$path.then") } ?: emptyList(),
                    otherwise = obj["else"]?.let { actionList(it, "$path.else") } ?: emptyList(),
                )
            }

            "\$append", "\$remove", "\$update" -> {
                // The parameters travel as carried; the gate applies the
                // encoding rules, in the order the document model spec fixes.
                val takes = ActionSpec.ArrayAction.PARAMETERS.getValue(name)
                val fieldEntry = obj["field"]
                ActionSpec.ArrayAction(
                    name = name,
                    key = (obj["key"] as? MilanoValue.StringValue)?.value,
                    at = obj["at"]?.let { docValue(it, "$path.at") },
                    field = (fieldEntry as? MilanoValue.StringValue)?.value,
                    fieldFound = fieldEntry?.takeIf { it !is MilanoValue.StringValue }?.let { MilanoGate.name(it) },
                    value = obj["value"]?.let { docValue(it, "$path.value") },
                    extra = obj.keys.filter { it != "action" && it !in takes }.sorted(),
                )
            }

            else -> {
                if (name.startsWith("$")) {
                    throw MilanoBuildException.SchemaViolation(
                        rule = "action-encoding",
                        expected = "built-in action",
                        found = name,
                    )
                }
                if (!MilanoIdentifier.isValid(name)) {
                    throw MilanoBuildException.SchemaViolation(rule = "action-encoding", expected = "identifier", found = name)
                }
                val parameters = LinkedHashMap<String, DocValue>()
                var onSuccess: List<ActionSpec> = emptyList()
                var onFailure: List<ActionSpec> = emptyList()
                for ((key, value) in obj.entries.sortedBy { it.key }) {
                    when (key) {
                        "action" -> {}

                        "onSuccess" -> {
                            onSuccess = actionList(value, "$path.onSuccess")
                        }

                        "onFailure" -> {
                            onFailure = actionList(value, "$path.onFailure")
                        }

                        else -> {
                            parameters[key] = docValue(value, "$path.$key")
                        }
                    }
                }
                ActionSpec.Custom(name, parameters, onSuccess, onFailure)
            }
        }
    }
}
