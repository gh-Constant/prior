import SwiftUI
import WidgetKit

// MARK: - Timeline

struct SnapshotEntry: TimelineEntry {
    var date: Date
    var snapshot: WidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: SnapshotStore.sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: Date(), snapshot: SnapshotStore.load() ?? SnapshotStore.sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let entry = SnapshotEntry(date: Date(), snapshot: SnapshotStore.load())
        let refresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }
}

// MARK: - Shared bits

private struct WidgetHeader: View {
    var title: String
    var count: String

    var body: some View {
        HStack {
            Text(title).font(.headline)
            Spacer()
            Text(count)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

private struct TaskRow: View {
    var item: WidgetTaskItem

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(item.done ? .green : .secondary)
                .font(.caption)
            Text(item.title)
                .font(.callout)
                .lineLimit(1)
                .strikethrough(item.done)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Today widget

struct TodayWidgetView: View {
    var entry: SnapshotEntry

    var body: some View {
        let today = entry.snapshot?.today
        VStack(alignment: .leading, spacing: 6) {
            WidgetHeader(title: "Today", count: today.map { "\($0.open) open · \($0.done) done" } ?? "")
            if let items = today?.items, !items.isEmpty {
                ForEach(items.prefix(5), id: \.id) { item in
                    TaskRow(item: item)
                }
            } else {
                Text("All caught up")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .widgetURL(URL(string: "prior://widget/today"))
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "fr.constantsuchet.prior.widget.today", provider: SnapshotProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Prior Today")
        .description("Your tasks due today.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - Eisenhower matrix widget

private struct MatrixCell: View {
    var title: String
    var count: Int
    var color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text("\(count)").font(.title2).fontWeight(.semibold).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(8)
        .background(color.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

struct MatrixWidgetView: View {
    var entry: SnapshotEntry

    var body: some View {
        let matrix = entry.snapshot?.matrix
        VStack(alignment: .leading, spacing: 6) {
            WidgetHeader(title: "Priorities", count: "")
            HStack(spacing: 6) {
                MatrixCell(title: "Do", count: matrix?.focus ?? 0, color: .red)
                MatrixCell(title: "Schedule", count: matrix?.plan ?? 0, color: .blue)
            }
            HStack(spacing: 6) {
                MatrixCell(title: "Delegate", count: matrix?.quick ?? 0, color: .orange)
                MatrixCell(title: "Eliminate", count: matrix?.later ?? 0, color: .gray)
            }
        }
        .widgetURL(URL(string: "prior://widget/eisenhower"))
    }
}

struct MatrixWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "fr.constantsuchet.prior.widget.matrix", provider: SnapshotProvider()) { entry in
            MatrixWidgetView(entry: entry)
        }
        .configurationDisplayName("Prior Matrix")
        .description("Your Eisenhower quadrants at a glance.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - Inbox widget

struct InboxWidgetView: View {
    var entry: SnapshotEntry

    var body: some View {
        let inbox = entry.snapshot?.inbox
        VStack(alignment: .leading, spacing: 6) {
            WidgetHeader(title: "Inbox", count: inbox.map { "\($0.total)" } ?? "")
            if let items = inbox?.items, !items.isEmpty {
                ForEach(items.prefix(3), id: \.id) { item in
                    TaskRow(item: item)
                }
            } else {
                Text("Inbox zero")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .widgetURL(URL(string: "prior://widget/inbox"))
    }
}

struct InboxWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "fr.constantsuchet.prior.widget.inbox", provider: SnapshotProvider()) { entry in
            InboxWidgetView(entry: entry)
        }
        .configurationDisplayName("Prior Inbox")
        .description("Tasks waiting to be triaged.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Calendar widget

private struct CalendarItemRow: View {
    var item: WidgetCalendarItem

    var body: some View {
        HStack(spacing: 7) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hex: item.color))
                .frame(width: 4, height: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.callout).lineLimit(1)
                Text(item.startTime ?? "Anytime")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }
}

struct CalendarWidgetView: View {
    var entry: SnapshotEntry

    var body: some View {
        let items = entry.snapshot?.calendar.items ?? []
        VStack(alignment: .leading, spacing: 6) {
            WidgetHeader(title: "Calendar", count: "(items.count)")
            if items.isEmpty {
                Text("Nothing scheduled")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(items.prefix(4), id: \.id) { item in
                    CalendarItemRow(item: item)
                }
            }
            Spacer(minLength: 0)
        }
        .widgetURL(URL(string: "prior://widget/calendar"))
    }
}

struct CalendarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "fr.constantsuchet.prior.widget.calendar", provider: SnapshotProvider()) { entry in
            CalendarWidgetView(entry: entry)
        }
        .configurationDisplayName("Prior Calendar")
        .description("Your connected calendars and habits.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private extension Color {
    init(hex: String) {
        let value = UInt64(String(hex.dropFirst().prefix(6)), radix: 16) ?? 0xEF795B
        self.init(.sRGB, red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255, blue: Double(value & 0xff) / 255, opacity: 1)
    }
}

// MARK: - Previews

#if DEBUG
#Preview(as: .systemMedium) {
    TodayWidget()
} timeline: {
    SnapshotEntry(date: Date(), snapshot: SnapshotStore.sample)
}

#Preview(as: .systemMedium) {
    MatrixWidget()
} timeline: {
    SnapshotEntry(date: Date(), snapshot: SnapshotStore.sample)
}

#Preview(as: .systemSmall) {
    InboxWidget()
} timeline: {
    SnapshotEntry(date: Date(), snapshot: SnapshotStore.sample)
}

#Preview(as: .systemMedium) {
    CalendarWidget()
} timeline: {
    SnapshotEntry(date: Date(), snapshot: SnapshotStore.sample)
}
#endif
