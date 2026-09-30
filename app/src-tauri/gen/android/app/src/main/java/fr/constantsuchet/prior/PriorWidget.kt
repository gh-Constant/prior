package fr.constantsuchet.prior

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.Row
import androidx.glance.layout.RowScope
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import org.json.JSONArray
import org.json.JSONObject

/**
 * Home-screen widgets fed by the JSON snapshot the app exports on every
 * local/sync change (app/src/lib/widgetSnapshot.ts, same model as the macOS
 * widgets). They never depend on the webview being alive.
 */
object PriorWidgetStore {
    private const val PREFERENCES = "prior_widget"
    private const val SNAPSHOT = "snapshot"

    fun setSnapshot(context: Context, json: String) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(SNAPSHOT, json).apply()
    }

    fun snapshot(context: Context): JSONObject? = context
        .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .getString(SNAPSHOT, null)
        ?.let { runCatching { JSONObject(it) }.getOrNull() }

    suspend fun updateAll(context: Context) {
        TodayWidget().updateAll(context)
        MatrixWidget().updateAll(context)
        InboxWidget().updateAll(context)
        CalendarWidget().updateAll(context)
        QuickCaptureWidget().updateAll(context)
    }
}

private data class WidgetRow(val title: String, val detail: String? = null, val done: Boolean = false, val color: Color? = null)

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

private fun JSONObject.str(key: String): String? = if (isNull(key)) null else optString(key).ifEmpty { null }

private fun taskRows(section: JSONObject?): List<WidgetRow> = section?.optJSONArray("items").objects().map {
    WidgetRow(it.optString("title"), it.str("dueDate"), it.optBoolean("done"))
}

private fun parseColor(value: String?): Color? =
    value?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() }

private fun openIntent(context: Context, view: String) = Intent(Intent.ACTION_VIEW, Uri.parse("prior://widget/$view"))
    .setClass(context, MainActivity::class.java)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

private fun linkIntent(context: Context, url: String) = Intent(Intent.ACTION_VIEW, Uri.parse(url))
    .setClass(context, MainActivity::class.java)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

@Composable
private fun WidgetFrame(context: Context, view: String, title: String, count: String, content: @Composable ColumnScope.() -> Unit) {
    GlanceTheme {
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .appWidgetBackground()
                .cornerRadius(16.dp)
                .background(GlanceTheme.colors.widgetBackground)
                .padding(14.dp)
                .clickable(actionStartActivity(openIntent(context, view))),
        ) {
            Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 15.sp, fontWeight = FontWeight.Bold))
                Spacer(GlanceModifier.defaultWeight())
                Text(count, style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp))
            }
            Spacer(GlanceModifier.height(8.dp))
            content()
        }
    }
}

@Composable
private fun RowList(rows: List<WidgetRow>, empty: String) {
    if (rows.isEmpty()) {
        Text(empty, style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 14.sp))
        return
    }
    rows.take(6).forEach { row ->
        Row(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            if (row.color != null) {
                Box(GlanceModifier.width(4.dp).height(18.dp).cornerRadius(2.dp).background(ColorProvider(row.color))) {}
            } else {
                Text(if (row.done) "●" else "○", style = TextStyle(color = GlanceTheme.colors.primary, fontSize = 13.sp))
            }
            Spacer(GlanceModifier.width(8.dp))
            Text(row.title, maxLines = 1, style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp), modifier = GlanceModifier.defaultWeight())
            if (row.detail != null) {
                Text(row.detail, maxLines = 1, style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp))
            }
        }
    }
}

class TodayWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val today = PriorWidgetStore.snapshot(context)?.optJSONObject("today")
        val count = today?.let { context.getString(R.string.widget_today_count, it.optInt("open"), it.optInt("done")) }.orEmpty()
        provideContent {
            WidgetFrame(context, "today", context.getString(R.string.widget_today), count) {
                RowList(taskRows(today), context.getString(R.string.widget_today_empty))
            }
        }
    }
}

class InboxWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val inbox = PriorWidgetStore.snapshot(context)?.optJSONObject("inbox")
        provideContent {
            WidgetFrame(context, "inbox", context.getString(R.string.widget_inbox), inbox?.optInt("total")?.toString().orEmpty()) {
                RowList(taskRows(inbox), context.getString(R.string.widget_inbox_empty))
            }
        }
    }
}

class CalendarWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val items = PriorWidgetStore.snapshot(context)?.optJSONObject("calendar")?.optJSONArray("items").objects()
        val anytime = context.getString(R.string.widget_calendar_anytime)
        val rows = items.map { WidgetRow(it.optString("title"), it.str("startTime") ?: anytime, color = parseColor(it.str("color"))) }
        provideContent {
            WidgetFrame(context, "calendar", context.getString(R.string.widget_calendar), rows.size.toString()) {
                RowList(rows, context.getString(R.string.widget_calendar_empty))
            }
        }
    }
}

class MatrixWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val matrix = PriorWidgetStore.snapshot(context)?.optJSONObject("matrix")
        fun count(key: String) = matrix?.optInt(key) ?: 0
        provideContent {
            WidgetFrame(context, "eisenhower", context.getString(R.string.widget_matrix), "") {
                Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
                    MatrixCell(context.getString(R.string.widget_matrix_do), count("focus"), Color(0xFFE5484D))
                    Spacer(GlanceModifier.width(6.dp))
                    MatrixCell(context.getString(R.string.widget_matrix_schedule), count("plan"), Color(0xFF3E63DD))
                }
                Spacer(GlanceModifier.height(6.dp))
                Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
                    MatrixCell(context.getString(R.string.widget_matrix_delegate), count("quick"), Color(0xFFF76B15))
                    Spacer(GlanceModifier.width(6.dp))
                    MatrixCell(context.getString(R.string.widget_matrix_eliminate), count("later"), Color(0xFF8B8D98))
                }
            }
        }
    }
}

/**
 * Quick capture: a "+" that opens the new-task composer (prior://new-task)
 * and the next three Focus/Plan tasks of today, each opening its task.
 */
class QuickCaptureWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val items = PriorWidgetStore.snapshot(context)?.optJSONObject("focus")?.optJSONArray("items").objects()
        provideContent {
            GlanceTheme {
                Column(
                    modifier = GlanceModifier
                        .fillMaxSize()
                        .appWidgetBackground()
                        .cornerRadius(16.dp)
                        .background(GlanceTheme.colors.widgetBackground)
                        .padding(14.dp),
                ) {
                    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            context.getString(R.string.widget_quick),
                            style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 15.sp, fontWeight = FontWeight.Bold),
                            modifier = GlanceModifier.defaultWeight().clickable(actionStartActivity(openIntent(context, "today"))),
                        )
                        Box(
                            modifier = GlanceModifier
                                .width(40.dp)
                                .height(40.dp)
                                .cornerRadius(20.dp)
                                .background(ColorProvider(Color(0xFFF35F43)))
                                .clickable(actionStartActivity(linkIntent(context, "prior://new-task"))),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("+", style = TextStyle(color = ColorProvider(Color.White), fontSize = 24.sp, fontWeight = FontWeight.Bold))
                        }
                    }
                    Spacer(GlanceModifier.height(8.dp))
                    if (items.isEmpty()) {
                        Text(context.getString(R.string.widget_quick_empty), style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 14.sp))
                    }
                    items.take(3).forEach { item ->
                        val focus = item.optString("quadrant") == "focus"
                        Row(
                            modifier = GlanceModifier
                                .fillMaxWidth()
                                .padding(vertical = 5.dp)
                                .clickable(actionStartActivity(linkIntent(context, "prior://task/" + Uri.encode(item.optString("id"))))),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(GlanceModifier.width(4.dp).height(18.dp).cornerRadius(2.dp).background(ColorProvider(if (focus) Color(0xFFE5484D) else Color(0xFF3E63DD)))) {}
                            Spacer(GlanceModifier.width(8.dp))
                            Text(item.optString("title"), maxLines = 1, style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp), modifier = GlanceModifier.defaultWeight())
                            Text(
                                context.getString(if (focus) R.string.widget_matrix_do else R.string.widget_matrix_schedule),
                                maxLines = 1,
                                style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RowScope.MatrixCell(title: String, count: Int, color: Color) {
    Column(
        GlanceModifier.defaultWeight().fillMaxSize().cornerRadius(10.dp)
            .background(ColorProvider(color.copy(alpha = 0.14f))).padding(8.dp),
    ) {
        Text(title, maxLines = 1, style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp))
        Text(count.toString(), style = TextStyle(color = ColorProvider(color), fontSize = 22.sp, fontWeight = FontWeight.Bold))
    }
}

// PriorWidgetReceiver keeps its name so Today widgets placed before the
// multi-widget release stay bound.
class PriorWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}

class MatrixWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = MatrixWidget()
}

class InboxWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = InboxWidget()
}

class CalendarWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CalendarWidget()
}

class QuickCaptureWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = QuickCaptureWidget()
}
