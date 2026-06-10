# Bus Filtering & Type Display Fix

## ✅ Fixed Issues

### 1. Bus Type Display
**BEFORE:** Showing "undefined" for bus type
**AFTER:** Correctly shows "Type A", "Type C", or "Type D"

**Fix:** Changed from `bus.type` to `bus.busType` (matches JSON structure)

### 2. Charging Specifications
**BEFORE:** Showing undefined for charging speeds
**AFTER:** Correctly pulls from `bus.maxVehicleAcceptanceRate`

**Examples:**
- DC Fast Charge: `110 kW` (from `maxVehicleAcceptanceRate.dcfc`)
- AC Level 2: `19.2 kW` (from `maxVehicleAcceptanceRate.level2`)

### 3. Warranty Display
**BEFORE:** Showing `[object Object]`
**AFTER:** Shows actual warranty text or "Contact manufacturer"

**Fix:** Extracts from `warranty.battery` or `warranty.vehicle` fields

## 🔍 New Filtering Features

### Filter Options (Per Route)
Users can now filter compatible buses by:

1. **Bus Type**
   - All Types (default)
   - Type A
   - Type C
   - Type D

2. **Manufacturer**
   - All Manufacturers (default)
   - Dynamically populated from compatible buses
   - Examples: Blue Bird, Thomas Built, GreenPower, etc.

3. **DC Fast Charging**
   - Any DC Fast Charge (default)
   - Has DCFC
   - No DCFC

4. **AC Level 2 Charging**
   - Any AC Charging (default)
   - Has AC Level 2
   - No AC Level 2

### Filter UI
- **Location:** Above bus selection grid for each route
- **Style:** Light gray background with dropdown selects
- **Clear button:** Reset all filters with one click
- **No results message:** Shows when filters eliminate all options

### How Filters Work
```javascript
// Filters are applied instantly on change
// Multiple filters work together (AND logic)
// Hidden buses stay in DOM (display: none)
// Selected bus remains selected even if filtered out
```

## 📋 Data Attributes Added

Each bus card now has:
- `data-bus-type`: "Type A", "Type C", or "Type D"
- `data-manufacturer`: "Blue Bird", "Thomas Built", etc.
- `data-has-dcfc`: "yes" or "no"
- `data-has-ac`: "yes" or "no"

These enable efficient filtering without re-rendering.

## 🎨 Visual Updates

### Filter Section
```
┌──────────────────────────────────────┐
│ Filter buses:                        │
│                                      │
│ [All Types ▼] [All Manufacturers ▼] │
│ [Any DC Fast Charge ▼] [Any AC... ▼]│
│ [Clear Filters]                      │
└──────────────────────────────────────┘
```

### Bus Cards (Fixed)
```
┌────────────────────────────────────┐
│ Blue Bird All-American             │
│ ✓ SELECTED                         │
│                                    │
│ Type: Type D • 84 seats           │
│ Battery: 155 kWh                  │
│ GVWR: 36,200 lbs                  │
│ Rated Range: 150 mi               │
│ Effective Range: 105 mi           │
│ DC Fast Charge: 60 kW  ✓          │
│ AC Level 2: 19.2 kW    ✓          │
│ Warranty: 12 years/100k miles     │
│                                    │
│ $375k - $556k                     │
└────────────────────────────────────┘
```

## 📱 Mobile Responsive

Filters stack vertically on mobile:
- Full-width dropdowns
- Clear button below filters
- One bus card per row

## 🧪 Testing Checklist

1. ✅ Add route and calculate
2. ✅ Verify bus type shows correctly (A, C, or D)
3. ✅ Check charging speeds display with units (kW)
4. ✅ Verify warranty shows text (not [object Object])
5. ✅ Filter by Type A - should show smaller buses
6. ✅ Filter by manufacturer - should narrow results
7. ✅ Filter by "Has DCFC" - should show only fast-charge capable
8. ✅ Combine filters - should show intersection of criteria
9. ✅ Clear filters - should show all buses again
10. ✅ Select filtered bus - should stay selected
11. ✅ Test on mobile - filters should stack

## 🔧 Functions Added

### `filterBuses(routeIndex)`
- Reads filter values from dropdowns
- Shows/hides bus cards based on criteria
- Displays "no results" message if needed

### `clearFilters(routeIndex)`
- Resets all filter dropdowns to default
- Calls filterBuses() to show all buses

## 💡 Usage Tips

**For school districts:**
- Filter by Type A if you have narrow routes/streets
- Filter by manufacturer if you prefer specific brands
- Filter by DCFC if you need mid-day charging capability
- Filter by AC Level 2 if you only have overnight charging

**Multiple routes:**
- Each route has its own independent filters
- Different routes can show different bus types
- Helps compare options across different route needs

---

**Test at:** http://localhost:8000
