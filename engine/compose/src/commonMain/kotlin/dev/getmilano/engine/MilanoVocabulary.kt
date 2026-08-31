package dev.getmilano

import kotlinx.serialization.json.Json

/**
 * A parsed, validated vocabulary artifact: the consumer's component types,
 * events, global custom actions, and host functions, per the vocabulary
 * schema spec.
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
    /** The declared host functions (contract 2.1), by name. */
    val functions: Map<String, Function> = emptyMap(),
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
        /**
         * The failure completion's payload type (contract 2.1); null means
         * a failure carries no data (vocabulary schema spec, failure
         * payloads).
         */
        val failure: MilanoType? = null,
    )

    /**
     * A host function declaration (contract 2.1; vocabulary schema spec,
     * Function declarations): its argument types in order, and its return
     * type.
     */
    data class Function(
        val arguments: List<MilanoType>,
        val returns: MilanoType,
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
            // unsupported contract version fails fast at engine creation.
            if (!MilanoGate.isSupportedVersion(major, minor)) {
                throw MilanoEngineException.InvalidVocabulary(
                    "milano-version",
                    "unsupported contract version $milano; supported: ${MilanoGate.supportedRanges().joinToString()}",
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
                        actions[actionName] = action(declaration, actionName, major to minor)
                    }
                }

                else -> {
                    throw MilanoEngineException.InvalidVocabulary("actions", "actions is not an object")
                }
            }

            val functions = LinkedHashMap<String, Function>()
            val functionsEntry = rootRecord["functions"]
            if (functionsEntry != null) {
                // The artifact's declared version is a floor it holds itself
                // to: host functions need contract 2.1.
                if (!MilanoContractFeatures.has("functions", major, minor)) {
                    throw MilanoEngineException.InvalidVocabulary(
                        "contract-feature",
                        "functions need contract ${MilanoContractFeatures.versionOf("functions")}",
                    )
                }
                val declarations =
                    (functionsEntry as? MilanoValue.RecordValue)?.values
                        ?: throw MilanoEngineException.InvalidVocabulary("functions", "functions is not an object")
                for ((functionName, declaration) in declarations.entries.sortedBy { it.key }) {
                    if (!MilanoIdentifier.isValid(functionName)) {
                        throw MilanoEngineException.InvalidVocabulary("function-name", functionName)
                    }
                    functions[functionName] = function(declaration, functionName)
                }
            }

            return MilanoVocabulary(major, minor, name, vocabularyVersion, components, actions, functions)
        }

        /**
         * Parses one host function declaration; shared with builder
         * declarations. Any identifier will do: the contract's own
         * functions are called through the `$` namespace, so a vocabulary
         * declaring `round` gets its own `round(...)` beside `$round(...)`
         * and can never be shadowed. An empty argument list is refused
         * (`function-arguments`: a function of no arguments would be a
         * constant, or would read what its arguments do not carry).
         */
        internal fun function(
            declaration: MilanoValue,
            path: String,
        ): Function {
            val record =
                (declaration as? MilanoValue.RecordValue)?.values
                    ?: throw MilanoEngineException.InvalidVocabulary("function", "$path is not an object")
            val argumentsEntry = (record["arguments"] as? MilanoValue.ArrayValue)?.values
            if (argumentsEntry.isNullOrEmpty()) {
                throw MilanoEngineException.InvalidVocabulary("function-arguments", path)
            }
            val arguments =
                argumentsEntry.map { descriptor ->
                    MilanoType.fromDescriptor(descriptor)
                        ?: throw MilanoEngineException.InvalidVocabulary("function-argument", path)
                }
            val returns =
                record["returns"]?.let { MilanoType.fromDescriptor(it) }
                    ?: throw MilanoEngineException.InvalidVocabulary("function-returns", path)
            return Function(arguments, returns)
        }

        /**
         * Parses one custom action declaration; shared with builder
         * declarations, which use the same format. [contract] is the
         * artifact's declared version, which gates the declarations a later
         * minor introduced; builder declarations are code and always speak
         * the engine's contract.
         */
        internal fun action(
            declaration: MilanoValue,
            path: String,
            contract: Pair<Int, Int>? = null,
        ): Action {
            val record =
                (declaration as? MilanoValue.RecordValue)?.values
                    ?: throw MilanoEngineException.InvalidVocabulary("action", "$path is not an object")
            val parameters = LinkedHashMap<String, MilanoType>()
            when (val parametersEntry = record["parameters"]) {
                null -> {}

                is MilanoValue.RecordValue -> {
                    for ((parameterName, descriptor) in parametersEntry.values.entries.sortedBy { it.key }) {
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
            var failure: MilanoType? = null
            val failureEntry = record["failure"]
            if (failureEntry != null) {
                // The artifact's declared version is a floor it holds itself
                // to: a failure payload needs contract 2.1.
                if (contract != null && !MilanoContractFeatures.has("failure", contract.first, contract.second)) {
                    throw MilanoEngineException.InvalidVocabulary(
                        "contract-feature",
                        "$path declares a failure payload, which needs contract ${MilanoContractFeatures.versionOf("failure")}",
                    )
                }
                failure = MilanoType.fromDescriptor(failureEntry)
                    ?: throw MilanoEngineException.InvalidVocabulary("action-failure", path)
            }
            return Action(parameters, result, failure)
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
