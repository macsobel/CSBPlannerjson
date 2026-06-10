# Quick Start Guide

## Running the Application

### Option 1: Python HTTP Server (Recommended for Testing)
```powershell
# Navigate to the project directory
cd "c:\Users\Asobel\OneDrive - Environmental Protection Agency (EPA)\Coding\SchoolBusFinder"

# Start the server
python -m http.server 8000

# Open in browser: http://localhost:8000
```

### Option 2: Open Directly
Simply double-click `index.html` to open in your default browser.
Note: Some features (like loading JSON files) may not work due to browser security restrictions.

## Testing the Application

### Sample Route 1: Morning Elementary Route
- **Route Name**: Morning Elementary Route A
- **Distance**: 25 miles
- **Passengers**: 45
- **Stops**: 12
- **Terrain**: Flat
- **Time of Day**: Morning
- **Start Time**: 6:45 AM
- **End Time**: 8:15 AM

### Sample Route 2: Afternoon Middle School Route
- **Route Name**: Afternoon Middle School Route B
- **Distance**: 18 miles
- **Passengers**: 60
- **Stops**: 8
- **Terrain**: Rolling Hills
- **Time of Day**: Afternoon
- **Start Time**: 2:30 PM
- **End Time**: 3:45 PM

### Sample Route 3: Activity Bus
- **Route Name**: After-School Activities
- **Distance**: 12 miles
- **Passengers**: 30
- **Stops**: 5
- **Terrain**: Flat
- **Time of Day**: Evening
- **Start Time**: 5:00 PM
- **End Time**: 5:45 PM

### Test Scenarios

#### Scenario 1: Cold Climate
- **Depot Location**: Minneapolis, MN
- **Battery Degradation**: Checked
- **Expected Result**: Should show 30% winter derating, compatible buses with higher battery capacity

#### Scenario 2: Moderate Climate
- **Depot Location**: San Diego, CA
- **Battery Degradation**: Unchecked
- **Expected Result**: No climate derating, more buses should be compatible

#### Scenario 3: Mountainous Terrain
- **Depot Location**: Denver, CO
- **Routes**: All set to "Mountainous" terrain
- **Expected Result**: Significant range derating, fewer compatible buses

## Expected Results

### Compatible Buses (typical)
For moderate routes (40-60 total daily miles):
- Most Type C buses should be compatible
- Several Type A and Type D options
- Buses sorted by price (lowest first)

### Charger Recommendations

**Cost Optimized Scenario:**
- Primarily Level 2 AC chargers (19.2 kW)
- Lowest total cost
- Suitable for overnight charging

**Infrastructure Minimized:**
- Fewer DC fast chargers (50 kW)
- Shared charging approach
- Moderate cost

**Balanced:**
- Mix of Level 2 and DC fast
- Good operational flexibility
- Mid-range cost

**With Redundancy:**
- 20% additional chargers
- Backup for maintenance
- Highest cost

## Troubleshooting

### Issue: No buses found
**Solution**: 
- Reduce route distances
- Check passenger requirements aren't too high
- Consider splitting long routes

### Issue: Climate detection not working
**Solution**:
- Check internet connection (needs geocoding API)
- Try entering a more specific address
- Fallback: Tool assumes moderate climate

### Issue: Charts not displaying
**Solution**:
- Ensure internet connection (Highcharts loads from CDN)
- Check browser console for errors
- Verify JSON data loaded correctly

### Issue: JSON files not loading
**Solution**:
- Must run through HTTP server (not file:// protocol)
- Use Python HTTP server as shown above
- Check browser console for CORS errors

## Features to Test

- ✅ Add multiple routes
- ✅ Edit existing routes
- ✅ Delete routes
- ✅ Climate detection
- ✅ Battery degradation toggle
- ✅ Bus compatibility filtering
- ✅ Charger scenario switching
- ✅ Cost charts
- ✅ Range analysis charts
- ✅ Timeline visualization
- ✅ Export results to JSON
- ✅ Mobile responsive design (test on mobile device or browser dev tools)

## Known Limitations

1. **Climate Detection**: Simple latitude-based classification
2. **OEM Links**: Placeholders (not yet populated with actual URLs)
3. **TCO Calculations**: Not included (future enhancement)
4. **Multi-Bus Optimization**: Assumes 1 bus per fleet (could optimize for shared buses)
5. **Real-time Data**: Uses static October 2025 data

## Next Steps

1. Test on mobile devices
2. Add actual OEM website links
3. Implement Total Cost of Ownership calculator
4. Add electricity rate modeling
5. Integrate grant funding information
6. Add PDF export option
7. Implement fleet scheduling optimization

## Browser Testing Checklist

- [ ] Chrome/Edge (Windows)
- [ ] Firefox (Windows)
- [ ] Safari (Mac/iOS)
- [ ] Mobile Chrome (Android)
- [ ] Mobile Safari (iOS)
- [ ] Tablet view (responsive design)

## Performance Metrics

Expected load times:
- Initial page load: < 1 second
- Data loading: < 500ms (all JSON files)
- Climate detection: 1-3 seconds (API call)
- Calculation: < 1 second (for typical 3-5 routes)
- Chart rendering: < 500ms each

## Support

For issues or questions:
1. Check browser console for errors (F12)
2. Verify all data files are present
3. Ensure HTTP server is running
4. Test with sample routes above
5. Check README.md for detailed documentation
