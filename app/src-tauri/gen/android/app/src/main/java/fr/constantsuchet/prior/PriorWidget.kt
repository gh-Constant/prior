package fr.constantsuchet.prior

import android.content.Context
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.padding
import androidx.glance.text.Text
import androidx.glance.unit.ColorProvider

object PriorWidgetStore {
    private const val PREFERENCES = "prior_widget"
    private const val ITEMS = "items"

    fun setItems(context: Context, items: List<String>) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(ITEMS, items.take(3).toCollection(LinkedHashSet()))
            .apply()
    }

    fun items(context: Context): List<String> = context
        .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .getStringSet(ITEMS, emptySet())
        .orEmpty()
        .toList()
        .take(3)
}

class PriorWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val items = PriorWidgetStore.items(context)
        provideContent {
            Column(
                modifier = GlanceModifier
                    .background(ColorProvider(Color(0xFFF6F7F2)))
                    .padding(16.dp),
            ) {
                Text("Prior")
                items.forEach { item ->
                    Text("○ $item", modifier = GlanceModifier.padding(top = 8.dp))
                }
            }
        }
    }
}

class PriorWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = PriorWidget()
}
