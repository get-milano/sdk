package dev.getmilano.sample.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.getmilano.MilanoHost
import dev.getmilano.sample.environment.SampleEnvironment

/**
 * A full-screen Milano takeover. The document declares a `dismiss` action;
 * the host decides what dismissal means (leaving this screen).
 */
@Composable
fun InterstitialScreen(
    environment: SampleEnvironment,
    onDismiss: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        MilanoHost(
            builder = environment.interstitialBuilder(onDismiss),
            loading = {
                CircularProgressIndicator(
                    modifier = Modifier.fillMaxWidth().padding(top = 160.dp),
                )
            },
            failure = { error -> Text(error.toString(), modifier = Modifier.padding(24.dp)) },
        )
    }
}
