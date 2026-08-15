package dev.getmilano.sample.ui

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.getmilano.sample.environment.SampleEnvironment
import dev.getmilano.sample.ui.screens.DemoScreen
import dev.getmilano.sample.ui.screens.EmbeddedScreen
import dev.getmilano.sample.ui.screens.InterstitialScreen
import dev.getmilano.sample.ui.screens.MenuScreen
import dev.getmilano.sample.ui.screens.PokemonScreen

enum class Screen(
    val key: String,
    val title: String,
) {
    MENU("menu", "Milano"),
    BANNER_OVERLAY("banner", "Banner · Overlay"),
    BANNER_CARD("banner-card", "Banner · Card"),
    BANNER_STRIP("banner-strip", "Banner · Strip"),
    FORM("form", "Contact form"),
    TIP_CALCULATOR("tip-calculator", "Tip calculator"),
    CHECKBOX_GATE("checkbox-gate", "Checkbox gate"),
    POKEMON("pokemon", "Pokemon · Screen context"),
    EMBEDDED("embedded", "Embedded in native UI"),
    INTERSTITIAL("interstitial", "Interstitial"),
    ;

    companion object {
        fun fromKey(key: String?): Screen = entries.firstOrNull { it.key == key } ?: MENU
    }
}

/**
 * Menu + push navigation: each demo screen builds its MilanoView on entry,
 * so the loading view is visible every time.
 */
@Composable
fun SampleApp(
    environment: SampleEnvironment,
    initialScreen: Screen,
) {
    var screen by remember { mutableStateOf(initialScreen) }

    BackHandler(enabled = screen != Screen.MENU) {
        screen = Screen.MENU
    }

    when (screen) {
        Screen.MENU -> MenuScreen(onOpen = { screen = it })
        Screen.POKEMON -> PokemonScreen(environment)
        Screen.EMBEDDED -> EmbeddedScreen(environment)
        Screen.INTERSTITIAL -> InterstitialScreen(environment, onDismiss = { screen = Screen.MENU })
        else -> DemoScreen(builder = environment.builder(screen))
    }
}
