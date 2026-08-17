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

        return ParsedDocument(
            versionString,
            major,
            minor,
            vocabularyRequirement,
            contextDeclarations,
            stateDeclarations,
            rootNode,
            root["metadata"],
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
        for ((key, descriptor) in obj) {
            val type = MilanoType.fromDescriptor(descriptor)
            if (!MilanoIdentifier.isValid(key) || type == null) {
                throw MilanoBuildException.SchemaViolation(
                    rule = "$section-declaration",
                    expected = "type descriptor",
                    found = key,
                )
            }
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
                null -> null
                is MilanoValue.StringValue -> idEntry.value
                else -> throw MilanoBuildException.MalformedDocument("$path id is not a string")
            }

        val properties = LinkedHashMap<String, DocValue>()
        when (val propertiesEntry = obj["properties"]) {
            null -> {}

            is MilanoValue.RecordValue -> {
                for ((name, value) in propertiesEntry.values) {
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
                for ((event, actionsEntry) in onEntry.values) {
                    events[event] = actionList(actionsEntry, "$path.on.$event")
                }
            }

            else -> {
                throw MilanoBuildException.MalformedDocument("$path on is not an object")
            }
        }

        return RawNode(type, id, properties, children, events, entry)
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
                for ((key, value) in obj) {
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
