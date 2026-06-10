# Electric School Bus Route Planner

A comprehensive web-based tool to help school districts plan their electric school bus fleet transitions. Users can input multiple routes, and the tool analyzes compatible buses and provides optimized charger recommendations based on operational needs and constraints.

## Features

### Route Planning
- Add unlimited routes with detailed parameters:
  - Route distance (miles)
  - Passenger capacity requirements
  - Number of stops
  - Terrain type (flat, rolling hills, mountainous)
  - Route times and schedules
  - Edit and delete routes as needed
  - Visual timeline of daily operations

### Climate-Aware Range Calculations
- Automatic climate detection based on depot location
- Applies winter derating for cold climates (30% reduction)
- Adjustable terrain impact on range
- Optional 5-year battery degradation consideration (10% reduction)

### Bus Compatibility Analysis
- Filters all Type A, C, and D electric school buses
- Checks passenger capacity requirements
- Calculates effective range with all derating factors
- Identifies if mid-day charging is needed
- Shows route assignments for each compatible bus
- Comprehensive bus specifications including:
  - Price ranges (from state contracts)
  - Battery capacity and range
  - Charging capabilities
  - Warranty information
  - Delivery times

### Intelligent Charger Optimization
Four different charging scenarios to meet diverse needs:

1. **Cost Optimized**: Minimizes upfront costs with Level 2 chargers
2. **Infrastructure Minimized**: Fewer, more powerful DC fast chargers
3. **Balanced**: Mix of Level 2 and DC fast chargers for flexibility
4. **With Redundancy**: Additional chargers for backup and maintenance

Each scenario includes:
- Equipment costs
- Estimated installation costs
- Total investment calculations
- Detailed charger specifications and quantities

### Data Visualizations
- Cost comparison charts (bus + infrastructure)
- Range analysis vs. daily requirements
- Daily route timeline visualization
- Interactive Highcharts with export capabilities

### Data Export
- Export complete analysis results as JSON
- Includes all inputs, compatible buses, and recommendations

## Technology Stack

- **HTML5**: Semantic markup
- **CSS3**: Modern, responsive design with CSS Grid and Flexbox
- **Vanilla JavaScript**: No frameworks required
- **Highcharts**: EPA-approved charting library for data visualization
- **OpenStreetMap Nominatim API**: Free geocoding for climate detection

## Data Sources

All bus and charger data sourced from:
- WRI's Electric School Bus U.S. Buyer's Guide 2025 (October 2025)
- State contract pricing data from 2024-25
- Manufacturer specifications

## Configuration

Range derating factors and other assumptions can be easily modified in `app.js`:

```javascript
const RANGE_DERATING_FACTORS = {
    coldClimate: 0.30,              // 30% range reduction in cold climates
    batteryDegradation5Year: 0.10,  // 10% capacity loss after 5 years
    hillsTerrain: 0.15,             // 15% range reduction for rolling hills
    mountainousTerrain: 0.25,       // 25% range reduction for mountainous terrain
    stopsPenalty: 0.001             // 0.1% range reduction per stop
};

const CHARGING_TIME_SCENARIOS = {
    overnight: 12,      // 12 hours available for overnight charging
    midday: 4,          // 4 hours available for mid-day charging
    afternoon: 5        // 5 hours between routes
};

const CHARGER_REDUNDANCY_FACTOR = 0.20; // 20% extra chargers for redundancy
```

## File Structure

```
SchoolBusFinder/
├── index.html              # Main application page
├── assets/
|   └── styles.css          # All styling (mobile-responsive)
├── app.js                  # Application logic and calculations
├── README.md               # This file
├── docs/                   # Documentation (CONFIGURATION, QUICKSTART, etc.)
└── data/
    ├── buses-type-a.json   # Type A bus specifications
    ├── buses-type-c.json   # Type C bus specifications
    ├── buses-type-d.json   # Type D bus specifications
    └── chargers.json       # EV charger specifications
```

## Usage

1. **Set Depot Location**: Enter your depot address or zip code to automatically detect climate conditions
2. **Configure Options**: Optionally enable 5-year battery degradation consideration
3. **Add Routes**: Click "Add Route" and fill in route details
   - Repeat for all daily routes
4. **Calculate**: Click "Calculate Bus & Charger Recommendations"
5. **Review Results**: 
   - View compatible buses sorted by cost
   - Compare different charger scenarios
   - Analyze visualizations
   - Export results for sharing

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile responsive design
- No Internet Explorer support

## EPA Compliance

- Uses only EPA-approved JavaScript libraries (Highcharts)
- No external dependencies beyond approved sources
- Follows EPA web development guidelines

## Future Enhancements

Potential additions:
- Total Cost of Ownership (TCO) calculations
- Electricity rate modeling
- Grant funding integration
- V2G revenue potential analysis
- Fleet scheduling optimization
- Multi-depot support
- API integration with utility providers

## Disclaimer

This tool provides estimates based on manufacturer specifications and industry data. Actual performance may vary based on:
- Specific operating conditions
- Driver behavior
- Weather patterns
- Actual terrain
- Bus loading
- Maintenance practices

Always consult with bus manufacturers, charging infrastructure providers, and electrical engineers for final specifications and requirements.

## Contact

For questions or feedback about this tool, please contact your school district's transportation department or fleet management team.

## License

This tool is provided as-is for educational and planning purposes.

---

**Data Version**: October 2025 (WRI Electric School Bus U.S. Buyer's Guide 2025)

**Last Updated**: December 2025
