# Troubleshooting Guide

## Issue: "Highcharts error #17" and possible data loading issues

### Fixes Applied:

1. **Added missing Highcharts modules** to `index.html`:
   - `highcharts-more.js` 
   - `xrange.js` (required for timeline chart)

2. **Enhanced data loading with better error messages**:
   - Added detailed console logging
   - Better error reporting if files don't load

3. **Added compatibility debugging**:
   - Logs why each bus is/isn't compatible
   - Shows effective range calculations
   - Displays climate derating factors

## To Test:

### Step 1: Restart the server (if needed)
```powershell
# Kill any existing server
Get-Process python | Stop-Process

# Navigate to project
cd "c:\Users\Asobel\OneDrive - Environmental Protection Agency (EPA)\Coding\SchoolBusFinder"

# Start server
python -m http.server 8000
```

### Step 2: Run Diagnostic Test
1. Open: **http://localhost:8000/diagnostic.html**
2. Click "Test Data Loading" button
3. Click "Test 50 miles, 50 passengers route" button
4. Check if data loads and buses are found

### Step 3: Test Main App
1. Open: **http://localhost:8000**
2. Open browser console (F12) to see detailed logs
3. Add route: 50 miles, 50 passengers, 7:00-8:30
4. Click "Calculate Bus & Charger Recommendations"
5. Check console for detailed debugging info

## Expected Results for Your Route:

**Route: 50 miles, 50 passengers, 7:00-8:30, Flat terrain**

### Without Climate Derating:
Should find **MANY** compatible buses including:
- Blue Bird Vision (Type C) - 77 seats, 150 mile range
- RIDE Type C - 72 seats, 115-170 mile range  
- IC Bus CE Series - 78 seats, 135-200 mile range
- Thomas Jouley - 81 seats, 150-167 mile range
- Several Type D buses with even more capacity

### With Cold Climate (30% derating):
- 150 mile range becomes 105 miles effective
- Still should handle 50 miles comfortably

### With 5-Year Battery Degradation:
- Additional 10% reduction
- 150 miles → 105 miles (cold) → 94.5 miles (degradation)
- Still adequate for 50 miles

## What to Look For in Console:

```
✅ Data loaded successfully: {typeA: 7, typeC: 4, typeD: 5, totalBuses: 16, chargers: 9}
Checking compatibility for 16 buses against 1 routes
Climate: {isColdClimate: false, deratingFactor: 0}
✅ Compatible buses: 12
❌ Incompatible buses: 4
```

## If Still No Buses Found:

Check console logs for:
1. **Data loading errors** - Files might not be accessible
2. **Compatibility issues** - See why each bus is rejected
3. **Range calculations** - Effective range after derating

Common issues:
- Browser cache - Try hard refresh (Ctrl+Shift+R)
- CORS errors - Must use HTTP server, not file:// 
- Climate derating too aggressive - Try without entering depot location
- Battery degradation enabled - Try unchecking it

## Browser Console Commands:

Open console (F12) and type:

```javascript
// Check if data loaded
console.log('Buses:', busesData.length);
console.log('Chargers:', chargersData.length);

// Check first bus
console.log(busesData[0]);

// Check routes
console.log('Routes:', routes);
```

## Still Having Issues?

1. Check `diagnostic.html` results
2. Share console output (F12 → Console tab)
3. Check Network tab (F12) to see if JSON files load
4. Verify server is running on port 8000
