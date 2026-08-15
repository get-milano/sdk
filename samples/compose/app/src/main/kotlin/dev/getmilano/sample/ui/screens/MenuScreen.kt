package dev.getmilano.sample.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.getmilano.sample.ui.Screen

@Composable
fun MenuScreen(onOpen: (Screen) -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Milano SDK demos", style = MaterialTheme.typography.headlineSmall)
        for (screen in Screen.entries.filter { it != Screen.MENU }) {
            Button(onClick = { onOpen(screen) }, modifier = Modifier.fillMaxWidth()) {
                Text(screen.title)
            }
        }
    }
}
