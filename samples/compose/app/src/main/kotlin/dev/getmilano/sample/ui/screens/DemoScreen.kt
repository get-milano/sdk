package dev.getmilano.sample.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.getmilano.MilanoHost
import dev.getmilano.MilanoViewBuilder

@Composable
fun DemoScreen(builder: MilanoViewBuilder) {
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        MilanoHost(
            builder = builder,
            loading = {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(top = 120.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    CircularProgressIndicator()
                    Text("Building…")
                }
            },
            failure = { error ->
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Build failed", style = MaterialTheme.typography.titleMedium)
                    Text(error.toString(), style = MaterialTheme.typography.bodySmall)
                }
            },
        )
    }
}
