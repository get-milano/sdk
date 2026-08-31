package dev.getmilano.sample.desktop.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.getmilano.sample.desktop.environment.SampleEnvironment
import dev.getmilano.sample.desktop.ui.screens.DemoScreen
import dev.getmilano.sample.desktop.ui.screens.EmbeddedScreen
import dev.getmilano.sample.desktop.ui.screens.InterstitialScreen
import dev.getmilano.sample.desktop.ui.screens.MenuScreen
import dev.getmilano.sample.desktop.ui.screens.PokemonScreen
import dev.getmilano.sample.desktop.ui.screens.QuickActionsScreen
import dev.getmilano.sample.desktop.ui.screens.QuickStartScreen

enum class Screen(
    val key: String,
    val title: String,
) {
    MENU("menu", "Milano"),
    QUICKSTART("quickstart", "Quick start · One composable"),
    BANNER_OVERLAY("banner", "Banner · Overlay"),
    BANNER_CARD("banner-card", "Banner · Card"),
    BANNER_STRIP("banner-strip", "Banner · Strip"),
    FORM("form", "Contact form"),
    TIP_CALCULATOR("tip-calculator", "Tip calculator"),
    CHECKBOX_GATE("checkbox-gate", "Checkbox gate"),
    POKEMON("pokemon", "Pokemon · Screen context"),
    PROFILE("profile", "Profile · Whole screen"),
    CATALOG("catalog", "Catalog · Tap to open"),
    QUICK_ACTIONS("quick-actions", "Quick actions · Tap to open"),
    CARD_DETAIL("card-detail", "Card detail · Press to reveal"),
    EMBEDDED("embedded", "Embedded in native UI"),
    INTERSTITIAL("interstitial", "Interstitial"),
    ;

    companion object {
        fun fromKey(key: String?): Screen = entries.firstOrNull { it.key == key } ?: MENU
    }
}

/**
 * Menu + push navigation: each demo screen builds its MilanoView on entry,
 * so the loading view is visible every time. A desktop window has no
 * system back gesture, so the header carries the way back.
 */
@Composable
fun SampleApp(
    environment: SampleEnvironment,
    initialScreen: Screen,
) {
    var screen by remember { mutableStateOf(initialScreen) }

    Column(modifier = Modifier.fillMaxSize()) {
        if (screen != Screen.MENU) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                TextButton(onClick = { screen = Screen.MENU }) { Text("Back") }
                Text(screen.title, style = MaterialTheme.typography.titleMedium)
            }
            HorizontalDivider()
        }
        when (screen) {
            Screen.MENU -> MenuScreen(onOpen = { screen = it })
            Screen.QUICKSTART -> QuickStartScreen()
            Screen.POKEMON -> PokemonScreen(environment)
            Screen.PROFILE -> DemoScreen(builder = environment.profileBuilder())
            Screen.QUICK_ACTIONS -> QuickActionsScreen(environment, onOpen = { screen = it })
            Screen.CARD_DETAIL -> DemoScreen(builder = environment.cardDetailBuilder())
            Screen.EMBEDDED -> EmbeddedScreen(environment)
            Screen.INTERSTITIAL -> InterstitialScreen(environment, onDismiss = { screen = Screen.MENU })
            else -> DemoScreen(builder = environment.builder(screen))
        }
    }
}
