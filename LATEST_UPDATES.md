# Latest Updates - Enhanced Bus Selection & Timeline

## 🎯 Major Improvements

### 1. Route Analysis at Bus Selection
**NOW:** Route derating analysis shows up when selecting buses (Step 1)
- **Range Derating Factors** displayed for each route:
  - ❄️ Cold climate: -30%
  - 🏔️ Terrain impact: -15% (hills) or -25% (mountainous)
  - 🚏 Stops penalty: -0.1% per stop
  - 🔋 5-year battery degradation: -10%
- **Total Range Reduction** calculated and displayed
- Helps users understand why certain buses are compatible

### 2. Comprehensive Bus Specifications
**NOW:** Each selectable bus card shows detailed specs:
- ✅ **Type** & passenger capacity
- ✅ **Battery** capacity (kWh)
- ✅ **GVWR** (Gross Vehicle Weight Rating)
- ✅ **Rated Range** (manufacturer spec)
- ✅ **Effective Range** (calculated for THIS specific route)
- ✅ **DC Fast Charge** speed (kW)
- ✅ **AC Level 2** charge speed (kW)
- ✅ **Warranty** information
- ✅ **Price range**

### 3. Enhanced Charging Timeline (24-Hour View)
**FIXED:** Timeline now shows the complete picture:
- 🕐 **Full 24-hour day** (midnight to midnight)
- 🔵 **Route running time** (blue bars)
- 🟢 **Charging periods** (green bars) - calculated based on:
  - Energy used during route
  - Selected charger type power output
  - Charger scenario (overnight vs. fast charge)
- ⚪ **Idle time** (light gray)
- 🔄 **Dynamic updates** - changes when you switch charger scenarios

**Timeline Intelligence:**
- **Cost-Optimized/Infrastructure-Minimized**: Shows overnight charging (starts 6 PM or after route)
- **Balanced/Redundancy**: Shows faster charging right after route completion
- Charging time calculated from:
  - Bus battery capacity
  - Miles driven on route
  - Charger power output (from selected scenario)

### 4. Interactive Scenario Switching
- Click different charger scenario tabs (Cost Optimized, Min Infrastructure, Balanced, Redundancy)
- Timeline chart **automatically updates** to show charging schedule for that scenario
- See how different charger types affect your daily operations

## 📊 Visual Improvements

### Route Analysis Box
```
┌─────────────────────────────────────┐
│ Range Derating Analysis             │
│                                     │
│ ❄️ Cold climate: -30%              │
│ 🏔️ Rolling hills: -15%             │
│ 🚏 8 stops: -0.8%                   │
│ 🔋 5-year degradation: -10%         │
│                                     │
│ Total Range Reduction: 55.8%       │
│ (Buses shown have sufficient range) │
└─────────────────────────────────────┘
```

### Bus Selection Cards
```
┌────────────────────────────────────┐
│ Blue Bird Vision                   │
│ ✓ SELECTED                         │
│                                    │
│ Type: Type C • 77 seats           │
│ Battery: 155 kWh                  │
│ GVWR: 33,000 lbs                  │
│ Rated Range: 150 mi               │
│ Effective Range: 105 mi           │
│ DC Fast Charge: 60 kW             │
│ AC Level 2: 19.2 kW               │
│ Warranty: 12yr/100k mi            │
│                                    │
│ $320k - $360k                     │
└────────────────────────────────────┘
```

### Timeline Chart
```
Midnight                    Noon                    Midnight
|          |          |          |          |          |
Route A: [gray idle] [BLUE: 7-8:30am] [GREEN: charging 6pm-10pm] [gray]
Route B: [gray idle] [BLUE: 2-4pm] [GREEN: charging 4:30-7pm] [gray]
```

## 🔧 Technical Details

### New Functions
- `calculateChargingPeriods()` - Determines when and how long to charge based on:
  - Route energy consumption
  - Bus battery specs
  - Charger power output
  - Charging scenario type
- `calculateIdlePeriods()` - Fills in non-active times
- `minutesToTimeString()` - Formats minutes to "12:30 PM" format

### Enhanced Functions
- `displayBusSelection()` - Now includes route derating analysis
- `displayTimelineChart()` - Complete rewrite for 24-hour view with charging
- Scenario tab click handler - Triggers timeline refresh

### Data Flow
1. User selects buses → `selectBusForRoute()`
2. User clicks "Finalize Selection" → `finalizeSelection()`
3. Charger optimization runs on selected buses only
4. Timeline calculated with charging periods
5. User switches scenario → Timeline recalculates instantly

## 🎨 Style Improvements

- **Route analysis box**: Yellow background with warning-style border
- **Bus cards**: Taller (min 200px) with better spacing
- **Specs layout**: Bold labels, organized list format
- **Grid sizing**: Increased from 280px to 320px minimum width

## 🧪 Testing Recommendations

1. **Add a route** with multiple parameters (50 miles, 50 passengers, hills, 10 stops)
2. **Set depot location** in cold climate (e.g., "Minneapolis, MN")
3. **Calculate compatibility** - see derating analysis
4. **Review bus specs** - verify all fields show up correctly
5. **Select a bus** - ensure green checkmark appears
6. **Finalize selection** - verify timeline shows:
   - Route running time (blue)
   - Charging period (green)
   - Full 24-hour span
7. **Switch scenarios** - watch timeline update automatically

## 📝 Notes

- Timeline charging calculations are estimates based on ideal conditions
- Actual charging times may vary based on temperature, battery state, and other factors
- If charger data is missing, timeline will still show routes but not charging periods
- Mobile responsive - works on all screen sizes

---

**Server running at:** http://localhost:8000

*Check browser console (F12) for detailed debugging info if needed.*
