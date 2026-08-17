package dev.getmilano

import kotlinx.serialization.json.Json

/**
 * A parsed, validated vocabulary artifact: the consumer's component types,
 * events, and global custom actions, per the vocabulary schema spec.
 */
internal data class MilanoVocabulary(
    /** The contract version the artifact targets. */
    val contractMajor: Int,
    val contractMinor: Int,
    val name: String,
    /** Consumer-owned; surfaced in observability, never interpreted. */
    val version: String,
    val components: Map<String, Component>,
    val actions: Map<String, Action>,
) {
    data class Component(
        /** Property name to type. */
        val properties: Map<String, MilanoType>,
        /**
         * Event name to payload type; a null payload means a payload-less
         * event. Presence in the map is what "declared" means.
         */
        val events: Map<String, MilanoType?>,
        /** Whether nodes of this type accept children. */
        val children: Boolean,
        /**
         * When true, undeclared properties are a SchemaViolation instead of
         * ignored-and-reported.
         */
        val strict: Boolean,
    )

    data class Action(
        /** Parameter name to type. */
        val parameters: Map<String, MilanoType>,
        /**
         * The success completion's value type; null means completions carry
         * no data (vocabulary schema spec, completion results).
         */
        val result: MilanoType? = null,
    )

    companion object {
        /**
         * Parses and validates a vocabulary artifact from JSON text.
         * Throws [MilanoEngineException.InvalidVocabulary] on any rule violation.
         */
        fun parse(artifactJson: String): MilanoVocabulary {
            val root =
                try {
                    MilanoValue.fromJson(Json.parseToJsonElement(artifactJson))
                } catch (_: Exception) {
                    throw MilanoEngineException.InvalidVocabulary("json", "not well-formed JSON")
                }
            val rootRecord =
                (root as? MilanoValue.RecordValue)?.values
                    ?: throw MilanoEngineException.InvalidVocabulary("structure", "artifact is not an object")

            val milano =
                (rootRecord["milano"] as? MilanoValue.StringValue)?.value
                    ?: throw MilanoEngineException.InvalidVocabulary("milano", "missing contract version")
            val versionParts = milano.split(".")
            val major = versionParts.getOrNull(0)?.toIntOrNull()
            val minor = versionParts.getOrNull(1)?.toIntOrNull()
            val patch = versionParts.getOrNull(2)?.toIntOrNull()
            if (versionParts.size != 3 || major == null || minor == null || patch == null ||
                major < 0 || minor < 0 || patch < 0
            ) {
                throw MilanoEngineException.InvalidVocabulary("milano", "expected major.minor.patch, found $milano")
            }
            // Same versioning rule as documents: an artifact targeting an
            // unsupported contract major fails fast at engine creation.
            if (major !in MilanoGate.SUPPORTED_MAJORS) {
                throw MilanoEngineException.InvalidVocabulary(
                    "milano-version",
                    "unsupported contract major $major; supported: ${MilanoGate.SUPPORTED_MAJORS}",
                )
            }

            val name =
                (rootRecord["name"] as? MilanoValue.StringValue)
                    ?.value
                    ?.takeIf { MilanoIdentifier.isValid(it) }
                    ?: throw MilanoEngineException.InvalidVocabulary("name", "missing or invalid identifier")
            val vocabularyVersion =
                (rootRecord["version"] as? MilanoValue.StringValue)
                    ?.value
                    ?.takeIf { parseSemver(it) != null }
                    ?: throw MilanoEngineException.InvalidVocabulary(
                        "version",
                        "vocabulary version must be major.minor.patch",
                    )

            val componentsJson =
                (rootRecord["components"] as? MilanoValue.RecordValue)?.values
                    ?: throw MilanoEngineException.InvalidVocabulary("components", "missing components")
            val components = LinkedHashMap<String, Component>(componentsJson.size)
            for ((typeName, declaration) in componentsJson) {
                if (!MilanoIdentifier.isValid(typeName)) {
                    throw MilanoEngineException.InvalidVocabulary("component-name", typeName)
                }
                components[typeName] = component(declaration, typeName)
            }

            val actions = LinkedHashMap<String, Action>()
            when (val actionsEntry = rootRecord["actions"]) {
                null -> {}

                is MilanoValue.RecordValue -> {
                    for ((actionName, declaration) in actionsEntry.values) {
                        if (!MilanoIdentifier.isValid(actionName)) {
                            throw MilanoEngineException.InvalidVocabulary("action-name", actionName)
                        }
                        actions[actionName] = action(declaration, actionName)
                    }
                }

                else -> {
                    throw MilanoEngineException.InvalidVocabulary("actions", "actions is not an object")
                }
            }

            return MilanoVocabulary(major, minor, name, vocabularyVersion, components, actions)
        }

        /**
         * Parses one custom action declaration; shared with document-local
         * declarations, which use the same format (document model spec).
         */
        internal fun action(
            declaration: MilanoValue,
            path: String,
        ): Action {
            val record =
                (declaration as? MilanoValue.RecordValue)?.values
                    ?: throw MilanoEngineException.InvalidVocabulary("action", "$path is not an object")
            val parameters = LinkedHashMap<String, MilanoType>()
            when (val parametersEntry = record["parameters"]) {
                null -> {}

                is MilanoValue.RecordValue -> {
                    for ((parameterName, descriptor) in parametersEntry.values) {
                        val type = MilanoType.fromDescriptor(descriptor)
                        if (!MilanoIdentifier.isValid(parameterName) || type == null) {
                            throw MilanoEngineException.InvalidVocabulary("action-parameter", "$path.$parameterName")
                        }
                        parameters[parameterName] = type
                    }
                }

                else -> {
                    throw MilanoEngineException.InvalidVocabulary("action-parameters", path)
                }
            }
            var result: MilanoType? = null
            val resultEntry = record["result"]
            if (resultEntry != null) {
                result = MilanoType.fromDescriptor(resultEntry)
                    ?: throw MilanoEngineException.InvalidVocabulary("action-result", path)
            }
            return Action(parameters, result)
        }

        private fun component(
            declaration: MilanoValue,
            path: String,
        ): Component {
            val record =
                (declaration as? MilanoValue.RecordValue)?.values
                    ?: throw MilanoEngineException.InvalidVocabulary("component", "$path is not an object")

            val properties = LinkedHashMap<String, MilanoType>()
            when (val propertiesEntry = record["properties"]) {
                null -> {}

                is MilanoValue.RecordValue -> {
                    for ((propertyName, descriptor) in propertiesEntry.values) {
                        val type = MilanoType.fromDescriptor(descriptor)
                        if (!MilanoIdentifier.isValid(propertyName) || type == null) {
                            throw MilanoEngineException.InvalidVocabulary("component-property", "$path.$propertyName")
                        }
                        properties[propertyName] = type
                    }
                }

                else -> {
                    throw MilanoEngineException.InvalidVocabulary("component-properties", path)
                }
            }

            val events = LinkedHashMap<String, MilanoType?>()
            when (val eventsEntry = record["events"]) {
                null -> {}

                is MilanoValue.RecordValue -> {
                    for ((eventName, descriptor) in eventsEntry.values) {
                        if (!MilanoIdentifier.isValid(eventName)) {
                            throw MilanoEngineException.InvalidVocabulary("component-event", "$path.$eventName")
                        }
                        if (descriptor is MilanoValue.Null) {
                            events[eventName] = null
                        } else {
                            events[eventName] = MilanoType.fromDescriptor(descriptor)
                                ?: throw MilanoEngineException.InvalidVocabulary("component-event", "$path.$eventName")
                        }
                    }
                }

                else -> {
                    throw MilanoEngineException.InvalidVocabulary("component-events", path)
                }
            }

            val children =
                when (val flag = record["children"]) {
                    null -> false
                    is MilanoValue.BoolValue -> flag.value
                    else -> throw MilanoEngineException.InvalidVocabulary("component-children", path)
                }
            val strict =
                when (val flag = record["strict"]) {
                    null -> false
                    is MilanoValue.BoolValue -> flag.value
                    else -> throw MilanoEngineException.InvalidVocabulary("component-strict", path)
                }

            return Component(properties, events, children, strict)
        }
    }
}
