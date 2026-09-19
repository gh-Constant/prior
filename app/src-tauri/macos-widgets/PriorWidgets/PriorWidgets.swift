import WidgetKit

/// Prior macOS widgets: Today, Eisenhower matrix and Inbox. Data comes from
/// the JSON snapshot the app exports into the shared App Group container
/// (see SnapshotStore); no network, no login, default system styling.
@main
struct PriorWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        MatrixWidget()
        InboxWidget()
    }
}
