package dev.getmilano.sample.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import dev.getmilano.MilanoHost
import dev.getmilano.sample.environment.SampleEnvironment
import dev.getmilano.sample.ui.Screen

/**
 * Milano as an embedded fragment: a native card, a Milano banner, and a
 * native carousel sharing one screen. The Milano subtree is just another
 * composable in the hierarchy.
 */
@Composable
fun EmbeddedScreen(environment: SampleEnvironment) {
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        NativeCard(
            icon = Icons.Filled.AccountBox,
            title = "Your balance",
            detail = "$1,240.50 · updated just now",
        )

        MilanoHost(
            builder = environment.builder(Screen.BANNER_STRIP),
            loading = { CircularProgressIndicator(modifier = Modifier.padding(24.dp)) },
        )

        NativeCarousel()
    }
}

@Composable
private fun NativeCard(
    icon: ImageVector,
    title: String,
    detail: String,
) {
    Card(modifier = Modifier.fillMaxWidth().padding(top = 16.dp, start = 16.dp, end = 16.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(16.dp),
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(detail, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun NativeCarousel() {
    val items =
        listOf(
            Icons.Filled.Place to "Trips",
            Icons.Filled.Star to "Favorites",
            Icons.Filled.ShoppingCart to "Deals",
        )
    Column(modifier = Modifier.padding(vertical = 8.dp)) {
        Text(
            "Plan something",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(16.dp),
        ) {
            items(items.size) { index ->
                Card {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.size(width = 104.dp, height = 88.dp).padding(12.dp),
                    ) {
                        Icon(items[index].first, contentDescription = null)
                        Text(items[index].second, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}
