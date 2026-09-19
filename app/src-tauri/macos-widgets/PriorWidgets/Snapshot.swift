import Foundation

/// Snapshot written by the Prior app into the shared App Group container.
/// Keep in sync with app/src/lib/widgetSnapshot.ts.
struct WidgetTaskItem: Codable, Hashable, Sendable {
    var id: String
    var title: String
    var done: Bool
    var dueDate: String?
    var priority: Int
}

struct WidgetToday: Codable, Hashable, Sendable {
    var open: Int
    var done: Int
    var items: [WidgetTaskItem]
}

struct WidgetInbox: Codable, Hashable, Sendable {
    var total: Int
    var items: [WidgetTaskItem]
}

struct WidgetMatrix: Codable, Hashable, Sendable {
    var focus: Int
    var plan: Int
    var quick: Int
    var later: Int
}

struct WidgetCalendarItem: Codable, Hashable, Sendable {
    var id: String
    var title: String
    var date: String
    var startTime: String?
    var color: String
}

struct WidgetCalendar: Codable, Hashable, Sendable {
    var items: [WidgetCalendarItem]
}

struct WidgetSnapshot: Codable, Hashable, Sendable {
    var version: Int
    var app: String
    var updatedAt: String
    var today: WidgetToday
    var inbox: WidgetInbox
    var matrix: WidgetMatrix
    var calendar: WidgetCalendar
}

enum SnapshotStore {
    static let appGroup = "group.fr.constantsuchet.prior"
    static let fileName = "prior-widget-snapshot.json"

    static func load() -> WidgetSnapshot? {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroup
        ) else { return nil }
        let url = container.appendingPathComponent(fileName)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    /// Placeholder content for the widget gallery before the app exports data.
    static var sample: WidgetSnapshot {
        WidgetSnapshot(
            version: 1,
            app: "prior",
            updatedAt: "",
            today: WidgetToday(
                open: 3,
                done: 1,
                items: [
                    WidgetTaskItem(id: "1", title: "Review the launch plan", done: false, dueDate: nil, priority: 1),
                    WidgetTaskItem(id: "2", title: "Reply to Alice", done: false, dueDate: nil, priority: 2),
                    WidgetTaskItem(id: "3", title: "Book train tickets", done: false, dueDate: nil, priority: 3),
                ]
            ),
            inbox: WidgetInbox(
                total: 2,
                items: [
                    WidgetTaskItem(id: "4", title: "File the receipts", done: false, dueDate: nil, priority: 4),
                    WidgetTaskItem(id: "5", title: "Water the plants", done: false, dueDate: nil, priority: 4),
                ]
            ),
            matrix: WidgetMatrix(focus: 1, plan: 2, quick: 1, later: 2),
            calendar: WidgetCalendar(items: [
                WidgetCalendarItem(id: "6", title: "Focus block", date: "2026-09-14", startTime: "09:00", color: "#ef795b"),
                WidgetCalendarItem(id: "7", title: "Product sync", date: "2026-09-14", startTime: "09:30", color: "#6e73d9"),
            ])
        )
    }
}
