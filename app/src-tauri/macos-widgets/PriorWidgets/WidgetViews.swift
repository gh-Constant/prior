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

// MARK: - Previews

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
