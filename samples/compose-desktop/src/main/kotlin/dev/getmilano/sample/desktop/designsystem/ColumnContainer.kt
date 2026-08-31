package dev.getmilano.sample.desktop.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * A vertical stack. [padding] is what tells a screen's root column from a
 * column nested inside a tile: the root wants the screen's inset, a tile's
 * inner column wants none, and a nested column that kept the screen inset
 * would make every tile 32 dp wider than its content. [fillsWidth] is the
 * same distinction for width: a column inside a row must size to its
 * content, or the first one takes the width and its siblings are left
 * with none.
 */
@Composable
fun ColumnContainer(
    padding: Int = 16,
    fillsWidth: Boolean = true,
    content: @Composable () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .then(if (fillsWidth) Modifier.fillMaxWidth() else Modifier)
                .padding(padding.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        content()
    }
}
