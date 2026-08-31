package dev.getmilano.sample.desktop.ui.screens

import androidx.compose.runtime.Composable
import dev.getmilano.sample.desktop.environment.SampleEnvironment
import dev.getmilano.sample.desktop.milanobridge.NavigateScreen
import dev.getmilano.sample.desktop.ui.Screen

/**
 * A horizontal strip of tiles from one `$repeat` template: each tap
 * records the tapped tile's position through the repeat's index binding
 * and then asks the host to push a screen. The document never names a
 * destination class or a drawable; it names a declared screen and a
 * declared icon, and this host decides what both mean.
 */
@Composable
fun QuickActionsScreen(
    environment: SampleEnvironment,
    onOpen: (Screen) -> Unit,
) {
    DemoScreen(
        builder =
            environment.quickActionsBuilder { screen ->
                // The screen name is a declared enum member, so the gate
                // has already proved it is one of four; this maps it onto
                // the sample's own navigation.
                onOpen(
                    when (screen) {
                        NavigateScreen.Profile -> Screen.PROFILE
                        NavigateScreen.Catalog -> Screen.CATALOG
                        NavigateScreen.Pokemon -> Screen.POKEMON
                        NavigateScreen.Form -> Screen.FORM
                    },
                )
            },
    )
}
