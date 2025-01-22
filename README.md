# Apsley Scheduler Card

[![Buy Me a Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://www.buymeacoffee.com/apglitch)


The **Apsley Scheduler Card** is a custom Lovelace card for [Home Assistant](https://www.home-assistant.io/) that allows you to visually create and manage time-based schedules. It presents each day as a horizontal timeline where you can add timeslots, toggle on/off states, drag to reposition, and resize each timeslot boundary.

## Features

1. **Day-based Scheduling**  
   Each day shows a 24-hour timeline in a horizontal track. You can add, remove, or adjust timeslots for each day.

2. **Drag & Drop Timeslots**  
   - **Move Entire Slot**: Click and drag anywhere on an existing timeslot to reposition it within the 24-hour track.
   - **Resize Timeslot**: Select a timeslot, then drag one of its boundaries to adjust its start/end times.

3. **On/Off States**  
   Each timeslot can be turned **on** (with an associated `value`) or **off**. When off, the slot is highlighted differently to indicate it’s not active.

4. **Value Control**  
   When a timeslot is **on**, you can set a numerical `value` (e.g., target temperature, brightness, or any other control value) using a slider in the options panel.

5. **Overlap Prevention**  
   The card automatically prevents overlapping timeslots. If a move or resize would cause the timeslot to overlap another, it won’t be applied.

6. **Automatic Timeout**  
   After selecting a timeslot, the options panel is shown. If no further interaction happens within a few seconds, the panel automatically closes to keep the interface clean.

---

## Installation

1. **Copy the File**  
   Copy or download the JavaScript file containing this custom card into your Home Assistant’s `www/` folder. For example:  
   ```
   <config folder>/www/apsley-scheduler-card.js
   ```
2. **Add to Lovelace Resources**  
   Add the resource reference to your `configuration.yaml` or via the UI:

   ```yaml
   lovelace:
     resources:
       - url: /local/apsley-scheduler-card.js
         type: module
   ```

   If you manage resources through the UI (Settings > Dashboards > Three Dots Menu > Resources), use the same URL (`/local/apsley-scheduler-card.js`) and select **JavaScript Module**.

3. **Refresh**  
   Refresh your browser or clear cache to ensure the new card is loaded.

---

## Usage

Once the card is installed and the resource is referenced, you can add it to your Lovelace dashboard. An example configuration could look like this:

```yaml
type: custom:apsley-scheduler-card
name: "My Scheduler"
days:
  - dayName: Monday
    timeSlots:
      - start: 8
        end: 12
        on: true
        value: 50
  - dayName: Tuesday
    timeSlots: []
  - dayName: Wednesday
    timeSlots: []
  - dayName: Thursday
    timeSlots: []
  - dayName: Friday
    timeSlots: []
```

### Configuration Options

| Option     | Type   | Default                                        | Description                                                                                         |
|------------|--------|------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `name`     | string | `Scheduler`                                    | Title displayed at the top of the card.                                                             |
| `days`     | array  | See code defaults                               | An array of day objects. Each day object contains: <br>`dayName` (string) <br>`timeSlots` (array).  |
| `timeSlots`| array  | `[]`                                           | An array of time slot objects for that day. Each slot is `{ start, end, on, value }`.               |

### Timeslot Object

Each entry in `timeSlots` has the following structure:
```ts
interface TimeSlot {
  start: number;  // Hour of the day (0 - 24)
  end: number;    // Hour of the day (0 - 24)
  on: boolean;    // Whether this slot is active or not
  value: number;  // A user-defined numeric value for this slot
}
```
**Important**: The card will automatically prevent overlaps. You won’t be able to create or move timeslots such that `start < existing.end && existing.start < end`.

---

## Interaction

1. **Add a Timeslot**  
   Click on an empty portion of the day’s track. A new timeslot (2 hours by default) is created at the clicked position if it doesn’t overlap another slot.

2. **Select a Timeslot**  
   Click on an existing timeslot. The timeslot becomes highlighted, and the options panel (below the main card) appears showing its details.

3. **Move a Timeslot**  
   After selecting a timeslot, click and drag the slot (not the boundary) left or right along the track to change its start and end times.

4. **Resize a Timeslot**  
   Select a timeslot, then drag one of the slot boundaries to modify its start or end time. The boundaries only appear for the *selected* timeslot.

5. **Toggle On/Off**  
   In the options panel, switch the slot **on/off** with the toggle. When off, the slot is displayed with a different color, and the `value` field is hidden.

6. **Adjust Value**  
   If the slot is **on**, you can set the numeric value using the slider in the options panel.

7. **Delete Timeslot**  
   In the options panel, you can delete the currently selected timeslot with the **Delete Timeslot** button.

---

## Code Overview

### Core Variables

- **`_days`**: Tracks all configured days and their timeslots.
- **`_selectedDayIndex`/`_selectedSlotIndex`**: Stores which day and timeslot is currently selected.
- **`_isDragging`**: Indicates whether the user is actively dragging a timeslot or boundary.
- **`_focusTimeout`**: Holds a timeout ID used to automatically deselect the current timeslot after a short idle period.

### Drag Logic

1. **Dragging Entire Slots**  
   - `@pointerdown` on a timeslot sets `_draggingTrackDayIndex` and `_draggingTrackSlotIndex`, captures pointer, and calculates an offset (`_draggingTrackPointerFrac`) to track how far into the slot the cursor was when dragging started.
   - `@pointermove` repositions the slot, updating `start` and `end` hours if no overlap is detected.
   - `@pointerup` finalizes the position, releases pointer capture, and resets drag state.

2. **Dragging Boundaries**  
   - Only possible if the timeslot is selected (`_selectedDayIndex`/`_selectedSlotIndex`).
   - `@pointerdown` on a boundary sets `_dragBoundary` to `'start'` or `'end'`, storing the original hour for clamp checks.
   - `@pointermove` updates the boundary, again prevented from overlapping.
   - `@pointerup` finalizes the boundary position and resets drag state.

### Options Panel

When a slot is selected, the bottom panel is shown. It includes:

- Day name and time range.
- **On/Off Toggle** (`<ha-switch>`).
- **Value Slider** (only when the slot is on).
- **Delete** button to remove the slot entirely.

---

## Development

1. **Prerequisites**: Node.js, Yarn, or npm.  
2. **Install Dependencies**:  
   ```bash
   yarn install
   ```
3. **Build**:  
   ```bash
   yarn build
   ```
   or
   ```bash
   npm run build
   ```
4. **Serving**: Place the resulting JavaScript in your Home Assistant’s `www/` folder.

---

## Contributing

If you’d like to contribute improvements or new features:

1. Fork the repo and create a new branch.
2. Make changes and add tests where appropriate.
3. Submit a Pull Request.

---

## License

[MIT](./LICENSE) – feel free to modify and distribute, but provide attribution.

Enjoy scheduling with the **Apsley Scheduler Card**!

[![Buy Me a Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://www.buymeacoffee.com/apglitch)