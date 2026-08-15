package dev.getmilano.sample.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.getmilano.MilanoValue
import dev.getmilano.sample.environment.SampleEnvironment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URL

/**
 * One MilanoHost, two context sources: the app-wide shared context (the
 * trainer name) plus screen-specific values fetched from PokeAPI and
 * injected into this screen's builder. The document declares all four
 * keys; the gate validates them together at build.
 */
@Composable
fun PokemonScreen(environment: SampleEnvironment) {
    var screenContext by remember { mutableStateOf<Map<String, MilanoValue>?>(null) }
    var fetchFailure by remember { mutableStateOf<String?>(null) }

    // The screen owns its data: fetched before the document is built,
    // then handed to Milano as plain context values.
    LaunchedEffect(Unit) {
        try {
            val body =
                withContext(Dispatchers.IO) {
                    URL("https://pokeapi.co/api/v2/pokemon/pikachu").readText()
                }
            val json = JSONObject(body)
            val artwork =
                json
                    .getJSONObject("sprites")
                    .getJSONObject("other")
                    .getJSONObject("official-artwork")
                    .getString("front_default")
            screenContext =
                mapOf(
                    "pokemonName" to MilanoValue.StringValue(json.getString("name")),
                    "pokemonHeight" to MilanoValue.DoubleValue(json.getInt("height").toDouble()),
                    "pokemonWeight" to MilanoValue.DoubleValue(json.getInt("weight").toDouble()),
                    "pokemonImageUrl" to MilanoValue.StringValue(artwork),
                )
        } catch (error: Exception) {
            fetchFailure = error.toString()
        }
    }

    val context = screenContext
    val failure = fetchFailure
    when {
        context != null -> {
            DemoScreen(builder = environment.pokemonBuilder(context))
        }

        failure != null -> {
            Column(
                modifier = Modifier.fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Fetch failed", style = MaterialTheme.typography.titleMedium)
                Text(failure, style = MaterialTheme.typography.bodySmall)
            }
        }

        else -> {
            Column(
                modifier = Modifier.fillMaxWidth().padding(top = 120.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CircularProgressIndicator()
                Text("Fetching from PokeAPI…")
            }
        }
    }
}
