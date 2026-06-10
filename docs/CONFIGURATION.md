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

... (file content unchanged)