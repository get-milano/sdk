package dev.getmilano.sample

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import dev.getmilano.sample.environment.SampleEnvironment
import dev.getmilano.sample.ui.SampleApp
import dev.getmilano.sample.ui.Screen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val environment = SampleEnvironment(applicationContext)
        // Dev affordance: -e milano_screen banner|banner-card|banner-strip|form
        // opens a demo directly (used for screenshot automation).
        val initialScreen = Screen.fromKey(intent.getStringExtra("milano_screen"))

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    // Edge-to-edge is the platform default: keep Milano
                    // content out of the system bars.
                    Box(modifier = Modifier.systemBarsPadding()) {
                        SampleApp(environment, initialScreen)
                    }
                }
            }
        }
    }
}
