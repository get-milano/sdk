package dev.getmilano.sample.ui.screens

import android.util.Log
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.getmilano.MilanoHost
import dev.getmilano.MilanoNode
import dev.getmilano.MilanoRenderer
import dev.getmilano.MilanoValue

/**
 * The quick path end to end: no engine, registry, builder, or providers
 * in sight. One composable, an inline vocabulary and document, one
 * renderer, and an action closure. Every other screen goes through
 * SampleEnvironment, the full architecture for real apps.
 */
@Composable
fun QuickStartScreen() {
    MilanoHost(
        documentText = QUICKSTART_DOCUMENT,
        vocabularyJson = QUICKSTART_VOCABULARY,
        renderers = mapOf("Greeting" to GreetingRenderer),
        context = mapOf("userName" to MilanoValue.StringValue("Ada")),
        onAction = { action ->
            Log.d("quickstart", "dispatched ${action.name}")
            null
        },
        loading = { CircularProgressIndicator() },
        failure = { error ->
            Column(
                modifier = Modifier.fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(error.toString(), style = MaterialTheme.typography.bodySmall)
            }
        },
    )
}

private object GreetingRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        Text(
            text = node.property("text").stringOrNull ?: "",
            style = MaterialTheme.typography.titleLarge,
            modifier =
                Modifier
                    .padding(24.dp)
                    .clickable { node.emit("tap") },
        )
    }
}

private val QUICKSTART_VOCABULARY =
    """
    {"milano": "1.0.0", "name": "quickstart", "version": "1.0.0",
     "components": {"Greeting": {"properties": {"text": "string"}, "events": {"tap": null}}},
     "actions": {"celebrate": {}}}
    """.trimIndent()

private val QUICKSTART_DOCUMENT =
    """
    {"version": "1.0.0",
     "context": {"userName": "string"},
     "state": {"taps": "int"},
     "root": {"type": "Greeting", "id": "hello",
              "properties": {"text": {"${'$'}expr": "concat('Hello, ', context.userName, '! Taps: ', str(state.taps))"}},
              "on": {"tap": [{"action": "${'$'}set", "key": "taps", "value": {"${'$'}expr": "state.taps + 1"}},
                             {"action": "celebrate"}]}}}
    """.trimIndent()
