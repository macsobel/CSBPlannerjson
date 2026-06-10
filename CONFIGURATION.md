# Configuration Guide

This document explains how to modify key assumptions and settings in the Electric School Bus Route Planner.

## Location: app.js (Lines 6-23)

## Range Derating Factors

These factors determine how much the bus range is reduced under various conditions:

```javascript
const RANGE_DERATING_FACTORS = {
    coldClimate: 0.30,              // 30% range reduction in cold climates
    batteryDegradation5Year: 0.10,  // 10% capacity loss after 5 years
    hillsTerrain: 0.15,             // 15% range reduction for rolling hills
    mountainousTerrain: 0.25,       // 25% range reduction for mountainous terrain
    stopsPenalty: 0.001             // 0.1% range reduction per stop
};
```

### How to Modify:

**To increase winter derating to 40%:**
```javascript
coldClimate: 0.40,  // Change from 0.30 to 0.40
```

**To use Recurrent.com data for battery degradation (15% after 5 years):**
```javascript
batteryDegradation5Year: 0.15,  // Change from 0.10 to 0.15
```

**To reduce hills impact to 10%:**
```javascript
hillsTerrain: 0.10,  // Change from 0.15 to 0.10
```

---

## Charging Time Scenarios

These values define how much time is available for charging between routes:

```javascript
const CHARGING_TIME_SCENARIOS = {
    overnight: 12,      // 12 hours available for overnight charging
    midday: 4,          // 4 hours available for mid-day charging
    afternoon: 5        // 5 hours between routes
};
```

### How to Modify:

**To increase overnight charging window to 14 hours:**
```javascript
overnight: 14,  // Change from 12 to 14
```

**To account for faster turnaround (3 hours mid-day):**
```javascript
midday: 3,  // Change from 4 to 3
```

---

## Charger Redundancy

This factor determines how many extra chargers to include in the "With Redundancy" scenario:

```javascript
const CHARGER_REDUNDANCY_FACTOR = 0.20;  // 20% extra chargers for redundancy
```

### How to Modify:

**To increase redundancy to 30%:**
```javascript
const CHARGER_REDUNDANCY_FACTOR = 0.30;
```

**To reduce to 15%:**
```javascript
const CHARGER_REDUNDANCY_FACTOR = 0.15;
```

---

## Climate Detection Threshold

Location: `app.js`, function `detectClimate()` (around line 82)

```javascript
const isColdClimate = Math.abs(lat) > 40;
```

This determines if a location is considered "cold climate" based on latitude.

### How to Modify:

**To be more conservative (consider more areas as cold):**
```javascript
const isColdClimate = Math.abs(lat) > 35;  // Change from 40 to 35
```

**To be more restrictive (only very northern/southern areas):**
```javascript
const isColdClimate = Math.abs(lat) > 45;  // Change from 40 to 45
```

---

## Minimum State of Charge for Mid-Day Charging

Location: `app.js`, function `checkBusCompatibility()` (around line 172)

```javascript
if (currentCharge < effectiveRange * 0.2) { // Below 20% charge
```

### How to Modify:

**To trigger charging at 30% instead of 20%:**
```javascript
if (currentCharge < effectiveRange * 0.3) { // Change from 0.2 to 0.3
```

---

## Charger Optimization Ratios

Location: `app.js`, various optimization functions (lines 245-310)

### Cost Optimized Scenario

```javascript
const dcFastCount = Math.ceil(numBuses * 0.3); // 30% DC fast
const level2Count = numBuses - dcFastCount;
```

**To increase DC fast chargers to 40%:**
```javascript
const dcFastCount = Math.ceil(numBuses * 0.4); // Change to 0.4
```

### Infrastructure Minimized Scenario

```javascript
const chargerCount = Math.ceil(numBuses / 2);  // 2:1 bus to charger ratio
```

**To use 3:1 ratio (fewer chargers):**
```javascript
const chargerCount = Math.ceil(numBuses / 3);  // Change to 3
```

### Balanced Scenario

```javascript
const level2Count = Math.ceil(numBuses * 0.6);  // 60% Level 2
const dcCount = Math.ceil(numBuses * 0.4);      // 40% DC
```

**To change to 50/50 split:**
```javascript
const level2Count = Math.ceil(numBuses * 0.5);
const dcCount = Math.ceil(numBuses * 0.5);
```

---

## Installation Cost Estimates

Location: `app.js`, function `estimateInstallationCost()` (around line 329)

```javascript
const costs = {
    '$': 5000,
    '$$': 15000,
    '$$$': 35000,
    '$$$$': 75000
};
```

### How to Modify:

**To reflect higher installation costs in your area:**
```javascript
const costs = {
    '$': 7500,      // Increase from 5000
    '$$': 20000,    // Increase from 15000
    '$$$': 45000,   // Increase from 35000
    '$$$$': 100000  // Increase from 75000
};
```

---

## Data Files

### Adding New Buses

1. Open the appropriate file: `data/buses-type-a.json`, `buses-type-c.json`, or `buses-type-d.json`
2. Add a new object with this structure:

```json
{
    "id": "unique-id-here",
    "manufacturer": "Manufacturer Name",
    "model": "Model Name",
    "busType": "Type A",
    "priceRange": {
        "min": 300000,
        "max": 350000,
        "note": "State contract info"
    },
    "passengerCapacity": 30,
    "battery": {
        "nameplateKwh": 150,
        "usableKwh": 135
    },
    "range": {
        "nameplate": 120,
        "usable": 110
    },
    "maxVehicleAcceptanceRate": {
        "level2": 19.2,
        "dcfc": 120
    },
    "bidirectionalCapable": true,
    "oemWebsite": "https://manufacturer.com"
}
```

### Adding New Chargers

1. Open `data/chargers.json`
2. Add a new object following the existing structure

---

## Advanced Modifications

### Custom Derating Formula

Location: `app.js`, function `calculateEffectiveRange()` (around line 100)

Current formula applies each factor sequentially:

```javascript
effectiveRange *= (1 - RANGE_DERATING_FACTORS.coldClimate);
effectiveRange *= (1 - RANGE_DERATING_FACTORS.hillsTerrain);
```

**To use additive derating instead:**

```javascript
let totalDerating = 0;
if (climate && climate.isColdClimate) {
    totalDerating += RANGE_DERATING_FACTORS.coldClimate;
}
if (route.terrain === 'rolling') {
    totalDerating += RANGE_DERATING_FACTORS.hillsTerrain;
}
effectiveRange *= (1 - totalDerating);
```

### Custom Charging Logic

Location: `app.js`, function `checkBusCompatibility()` (around line 172)

You can modify when and how charging is triggered based on your specific operational needs.

---

## Testing Your Changes

After making modifications:

1. Save the file
2. Refresh your browser (Ctrl+F5 to force refresh)
3. Test with the sample routes in `QUICKSTART.md`
4. Verify results make sense
5. Check browser console (F12) for any errors

---

## Common Scenarios

### Scenario 1: More Aggressive Climate Derating
```javascript
coldClimate: 0.40,              // 40% instead of 30%
```

### Scenario 2: Account for AC/Heat Usage
Add a new factor:
```javascript
const RANGE_DERATING_FACTORS = {
    coldClimate: 0.30,
    hvacUsage: 0.15,            // NEW: 15% for heating/cooling
    // ... rest of factors
};
```

Then apply it in `calculateEffectiveRange()`:
```javascript
if (considerHVAC) {
    effectiveRange *= (1 - RANGE_DERATING_FACTORS.hvacUsage);
}
```

### Scenario 3: Custom Charger Mix
Modify the optimization functions to match your specific infrastructure plans.

---

## Getting Help

If you need help with modifications:

1. Check the browser console for error messages
2. Review the original values in this guide
3. Test with simple routes first
4. Verify JSON syntax if editing data files (use jsonlint.com)

## Backup Recommendation

Before making changes, create a backup:

```powershell
# In PowerShell
Copy-Item app.js app.js.backup
```

This allows you to easily restore if something goes wrong.
