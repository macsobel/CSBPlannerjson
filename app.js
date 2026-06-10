// ==========================
// Configuration & Constants
// ==========================
// Version: 2.0.1 - Fixed effectiveRange references

// EASY TO UPDATE ASSUMPTIONS - MODIFY THESE VALUES AS NEEDED
const RANGE_DERATING_FACTORS = {
    coldClimate: 0.30,          // 30% range reduction in cold climates (below freezing)
    batteryDegradation5Year: 0.10,  // 10% capacity loss after 5 years
    hillsTerrain: 0.15,         // 15% range reduction for rolling hills
    mountainousTerrain: 0.25,   // 25% range reduction for mountainous terrain
    stopsPenalty: 0.001         // 0.1% range reduction per stop (regenerative braking helps)
};

const CHARGING_TIME_SCENARIOS = {
    overnight: 12,      // 12 hours available for overnight charging
    midday: 4,          // 4 hours available for mid-day charging
    afternoon: 5        // 5 hours between trips
};

const CHARGER_REDUNDANCY_FACTOR = 0.20; // 20% extra chargers for redundancy

// ==========================
// State Management
// ==========================
// Wizard state
let currentStep = 1;
let completedSteps = new Set([1]); // Step 1 is always accessible
let selectedChargerScenario = null;

// Bus schedule data
let busSchedules = []; // Array of { id, name, trips: [], selectedBus: null }
let nextBusScheduleId = 1;

// Configuration data
let depotClimate = null;
let busesData = [];
let chargersData = [];
let currentResults = null;

// ==========================
// Data Loading
// ==========================
async function loadData() {
    try {
        console.log('Loading data files...');
        
        const [typeA, typeC, typeD, chargers] = await Promise.all([
            fetch('https://raw.githubusercontent.com/macsobel/CSBPlannerjson/refs/heads/main/buses-type-a.json').then(r => {
                if (!r.ok) throw new Error(`Failed to load Type A buses: ${r.status}`);
                return r.json();
            }),
            fetch('https://raw.githubusercontent.com/macsobel/CSBPlannerjson/refs/heads/main/buses-type-c.json').then(r => {
                if (!r.ok) throw new Error(`Failed to load Type C buses: ${r.status}`);
                return r.json();
            }),
            fetch('https://raw.githubusercontent.com/macsobel/CSBPlannerjson/refs/heads/main/buses-type-d.json').then(r => {
                if (!r.ok) throw new Error(`Failed to load Type D buses: ${r.status}`);
                return r.json();
            }),
            fetch('https://raw.githubusercontent.com/macsobel/CSBPlannerjson/refs/heads/main/chargers.json').then(r => {
                if (!r.ok) throw new Error(`Failed to load chargers: ${r.status}`);
                return r.json();
            })
        ]);
        
        // Process bus data to normalize range and battery capacity properties
        busesData = [...typeA, ...typeC, ...typeD].map(bus => {
            // Extract range from various possible formats
            let rangeRated = 0;
            
            if (bus.battery && bus.battery.options && bus.battery.options.length > 0) {
                // Use highest range option
                rangeRated = Math.max(...bus.battery.options.map(opt => opt.range || 0));
            } else if (bus.range) {
                // Use range.usable first, then range.nameplate
                rangeRated = bus.range.usable || bus.range.nameplate || bus.range.nameplate2 || 0;
            }
            
            // Extract battery capacity from various possible formats
            let batteryCapacity = 0;
            if (bus.battery) {
                if (bus.battery.usableKwh) {
                    batteryCapacity = bus.battery.usableKwh;
                } else if (bus.battery.nameplateKwh) {
                    batteryCapacity = bus.battery.nameplateKwh;
                } else if (bus.battery.options && bus.battery.options.length > 0) {
                    // Use highest capacity option
                    batteryCapacity = Math.max(...bus.battery.options.map(opt => opt.usableKwh || opt.nameplateKwh || 0));
                }
            }
            
            return {
                ...bus,
                rangeRated: rangeRated,
                batteryCapacity: batteryCapacity
            };
        });
        
        chargersData = chargers;
        
        console.log('✅ Data loaded successfully:', { 
            typeA: typeA.length, 
            typeC: typeC.length, 
            typeD: typeD.length, 
            totalBuses: busesData.length, 
            chargers: chargersData.length 
        });
        
        // Log first bus to verify data structure and rangeRated
        if (busesData.length > 0) {
            console.log('Sample bus data:', busesData[0]);
            console.log('Sample rangeRated:', busesData[0].rangeRated);
        }
        
    } catch (error) {
        console.error('❌ Error loading data:', error);
        alert(`Error loading bus and charger data: ${error.message}\n\nMake sure you're running this through a web server (e.g., python -m http.server 8000) and not opening the HTML file directly.\n\nCheck the browser console (F12) for more details.`);
    }
}

// ==========================
// Climate Detection
// ==========================
async function detectClimate(location) {
    if (!location || location.trim() === '') {
        return null;
    }

    try {
        // Using OpenStreetMap Nominatim API for geocoding (free, no API key required)
        // Restricting to US addresses only
        const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&countrycodes=us`;
        const response = await fetch(geocodeUrl, {
            headers: {
                'User-Agent': 'ElectricSchoolBusPlanner/1.0'
            }
        });
        
        if (!response.ok) {
            throw new Error('Geocoding failed');
        }
        
        const data = await response.json();
        
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            
            // Simple climate classification based on latitude
            // Cold climate zones (experiencing freezing temperatures):
            // Generally above 40° latitude in Northern Hemisphere
            // or below -40° in Southern Hemisphere
            const isColdClimate = Math.abs(lat) > 40;
            
            return {
                lat,
                lon,
                isColdClimate,
                location: data[0].display_name,
                deratingFactor: isColdClimate ? RANGE_DERATING_FACTORS.coldClimate : 0
            };
        }
        
        return null;
    } catch (error) {
        console.error('Error detecting climate:', error);
        // Fallback: assume moderate climate
        return {
            lat: null,
            lon: null,
            isColdClimate: false,
            location: location,
            deratingFactor: 0
        };
    }
}

// ==========================
// Range Calculations
// ==========================
function calculateEffectiveRange(bus, trip, climate, considerDegradation) {
    // Get base range
    let baseRange;
    
    if (bus.battery.options && bus.battery.options.length > 0) {
        // Use the highest range option
        baseRange = Math.max(...bus.battery.options.map(opt => opt.range || 0));
    } else {
        baseRange = bus.range.usable || bus.range.nameplate || 0;
    }
    
    if (!baseRange) return 0;
    
    let effectiveRange = baseRange;
    
    // Check global settings
    const weatherCheckbox = document.getElementById('considerWeather');
    const terrainCheckbox = document.getElementById('considerTerrain');
    const terrainDropdown = document.getElementById('terrainType');
    
    const useWeather = weatherCheckbox ? weatherCheckbox.checked : true;
    const useTerrain = terrainCheckbox ? terrainCheckbox.checked : false;
    
    // Apply climate derating
    if (useWeather && climate && climate.isColdClimate) {
        effectiveRange *= (1 - RANGE_DERATING_FACTORS.coldClimate);
    }
    
    // Apply battery degradation if enabled
    if (considerDegradation) {
        effectiveRange *= (1 - RANGE_DERATING_FACTORS.batteryDegradation5Year);
    }
    
    // Apply terrain derating
    let terrainToUse = 'flat';
    
    if (useTerrain && terrainDropdown) {
        terrainToUse = terrainDropdown.value;
    } else if (!terrainCheckbox && trip.terrain) {
        // Fallback for backward compatibility or if checkbox missing
        terrainToUse = trip.terrain;
    }
    
    if (terrainToUse === 'rolling' || terrainToUse === 'hills') {
        effectiveRange *= (1 - RANGE_DERATING_FACTORS.hillsTerrain);
    } else if (terrainToUse === 'mountainous') {
        effectiveRange *= (1 - RANGE_DERATING_FACTORS.mountainousTerrain);
    }
    
    // Apply stops penalty
    if (trip.stops) {
        const stopsPenalty = trip.stops * RANGE_DERATING_FACTORS.stopsPenalty;
        effectiveRange *= (1 - Math.min(stopsPenalty, 0.1)); // Cap at 10% max
    }
    
    return Math.round(effectiveRange);
}

// ==========================
// Bus Compatibility Checking
// ==========================
function checkBusCompatibility(bus, trips, climate, considerDegradation) {
    const compatibility = {
        compatible: true,
        issues: [],
        warnings: [],
        routeAssignments: [],
        totalDailyMiles: 0
    };
    
    // Check passenger capacity for each trip
    for (const trip of trips) {
        if (bus.passengerCapacity && trip.passengers > bus.passengerCapacity) {
            compatibility.compatible = false;
            compatibility.issues.push(
                `Insufficient capacity for ${trip.name}: needs ${trip.passengers} seats, bus has ${bus.passengerCapacity}`
            );
        }
    }
    
    // Calculate total daily mileage and check range
    const totalMiles = trips.reduce((sum, trip) => sum + trip.miles, 0);
    compatibility.totalDailyMiles = totalMiles;
    
    const effectiveRange = calculateEffectiveRange(bus, trips[0], climate, considerDegradation);
    
    // Check if bus can handle all trips
    if (totalMiles > effectiveRange) {
        // Check if mid-day charging could work
        const sortedRoutes = [...trips].sort((a, b) => {
            return (a.startTime || '').localeCompare(b.startTime || '');
        });
        
        let currentCharge = effectiveRange;
        let needsMidDayCharging = false;
        
        for (let i = 0; i < sortedRoutes.length; i++) {
            const trip = sortedRoutes[i];
            currentCharge -= trip.miles;
            
            if (currentCharge < effectiveRange * 0.2) { // Below 20% charge
                needsMidDayCharging = true;
                
                // Check if there's time to charge before next trip
                if (i < sortedRoutes.length - 1) {
                    const timeBetween = calculateTimeBetweenRoutes(trip, sortedRoutes[i + 1]);
                    if (timeBetween >= 2) { // At least 2 hours
                        compatibility.warnings.push(
                            `Requires mid-day fast charging (${timeBetween} hours available between trips)`
                        );
                        // Simulate charging
                        currentCharge = effectiveRange * 0.8; // Charge to 80%
                    } else {
                        compatibility.compatible = false;
                        compatibility.issues.push(
                            `Insufficient range and charging time between ${trip.name} and ${sortedRoutes[i + 1].name}`
                        );
                    }
                }
            }
        }
    }
    
    // Assign trips
    compatibility.routeAssignments = trips.map(r => r.name);
    
    return compatibility;
}

function calculateTimeBetweenRoutes(route1, route2) {
    if (!route1.endTime || !route2.startTime) return 0;
    
    const end = timeToMinutes(route1.endTime);
    const start = timeToMinutes(route2.startTime);
    
    return Math.max(0, (start - end) / 60);
}

function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

// ==========================
// Charger Optimization
// ==========================
function optimizeChargers(compatibleBuses, trips, climate) {
    // Handle case with no compatible buses
    if (!compatibleBuses || compatibleBuses.length === 0) {
        const emptyScenario = {
            name: 'N/A',
            description: 'No compatible buses found',
            chargers: [],
            totalCost: 0,
            estimatedInstallCost: 0
        };
        
        return {
            'cost-optimized': emptyScenario,
            'infrastructure-minimized': emptyScenario,
            'balanced': emptyScenario,
            'redundancy': emptyScenario
        };
    }
    
    const scenarios = {
        'cost-optimized': optimizeCostOptimized(compatibleBuses, trips),
        'infrastructure-minimized': optimizeInfrastructureMinimized(compatibleBuses, trips),
        'balanced': optimizeBalanced(compatibleBuses, trips),
        'redundancy': optimizeWithRedundancy(compatibleBuses, trips)
    };
    
    return scenarios;
}

function optimizeCostOptimized(buses, trips) {
    // Prefer Level 2 chargers (cheapest) when possible
    const numBuses = buses.length;
    const chargers = [];
    
    // Safety check
    if (numBuses === 0 || trips.length === 0) {
        return {
            name: 'Cost Optimized',
            description: 'Minimizes upfront charger costs',
            chargers: [],
            totalCost: 0,
            estimatedInstallCost: 0
        };
    }
    
    // Check if overnight Level 2 charging is sufficient
    const maxDailyMiles = Math.max(...trips.map(r => r.miles));
    const avgBusRange = buses.reduce((sum, b) => sum + (b.range.usable || b.range.nameplate || 0), 0) / buses.length;
    
    if (maxDailyMiles < avgBusRange * 0.7) {
        // Level 2 overnight charging sufficient
        const level2 = chargersData.find(c => c.id === 'level2-medium-ac-networkable');
        if (level2) {
            chargers.push({
                ...level2,
                quantity: numBuses,
                reason: 'Overnight charging sufficient for daily trips'
            });
        }
    } else {
        // Need mix of Level 2 and DC fast charging
        const level2 = chargersData.find(c => c.id === 'level2-medium-ac-networkable');
        const dcFast = chargersData.find(c => c.id === 'level3-slow-dc');
        
        const dcFastCount = Math.ceil(numBuses * 0.3); // 30% DC fast
        const level2Count = numBuses - dcFastCount;
        
        if (level2Count > 0 && level2) {
            chargers.push({
                ...level2,
                quantity: level2Count,
                reason: 'Primary overnight charging'
            });
        }
        
        if (dcFast) {
            chargers.push({
                ...dcFast,
                quantity: dcFastCount,
                reason: 'Mid-day quick charging capability'
            });
        }
    }
    
    return {
        name: 'Cost Optimized',
        description: 'Minimizes upfront charger costs by prioritizing Level 2 chargers',
        chargers,
        totalCost: calculateTotalChargerCost(chargers),
        estimatedInstallCost: estimateInstallationCost(chargers)
    };
}

function optimizeInfrastructureMinimized(buses, trips) {
    // Use fewer, more powerful chargers
    const numBuses = buses.length;
    const chargers = [];
    
    // Safety check
    if (numBuses === 0) {
        return {
            name: 'Infrastructure Minimized',
            description: 'Fewer, more powerful chargers',
            chargers: [],
            totalCost: 0,
            estimatedInstallCost: 0
        };
    }
    
    // Use DC fast chargers that can be shared
    const dcFast50 = chargersData.find(c => c.id === 'level3-fast-dc-50kw');
    
    // Assume 2:1 bus to charger ratio for DC fast
    const chargerCount = Math.ceil(numBuses / 2);
    
    if (dcFast50) {
        chargers.push({
            ...dcFast50,
            quantity: chargerCount,
            reason: 'Fast charging allows sharing chargers between buses'
        });
    }
    
    return {
        name: 'Infrastructure Minimized',
        description: 'Fewer, more powerful chargers to reduce infrastructure footprint',
        chargers,
        totalCost: calculateTotalChargerCost(chargers),
        estimatedInstallCost: estimateInstallationCost(chargers)
    };
}

function optimizeBalanced(buses, trips) {
    // Balanced approach
    const numBuses = buses.length;
    const chargers = [];
    
    // Safety check
    if (numBuses === 0) {
        return {
            name: 'Balanced',
            description: 'Mix of Level 2 and DC fast chargers',
            chargers: [],
            totalCost: 0,
            estimatedInstallCost: 0
        };
    }
    
    const level2 = chargersData.find(c => c.id === 'level2-medium-ac-networkable');
    const dcFast = chargersData.find(c => c.id === 'level3-slow-dc');
    
    // 60% Level 2, 40% DC
    const level2Count = Math.ceil(numBuses * 0.6);
    const dcCount = Math.ceil(numBuses * 0.4);
    
    if (level2) {
        chargers.push({
            ...level2,
            quantity: level2Count,
            reason: 'Primary overnight charging'
        });
    }
    
    if (dcFast) {
        chargers.push({
            ...dcFast,
            quantity: dcCount,
            reason: 'Flexibility for quick turnaround'
        });
    }
    
    return {
        name: 'Balanced',
        description: 'Mix of Level 2 and DC fast chargers for operational flexibility',
        chargers,
        totalCost: calculateTotalChargerCost(chargers),
        estimatedInstallCost: estimateInstallationCost(chargers)
    };
}

function optimizeWithRedundancy(buses, trips) {
    // Add redundancy for backup
    const baseScenario = optimizeBalanced(buses, trips);
    
    // Add 20% more chargers for redundancy
    const chargersWithRedundancy = baseScenario.chargers.map(c => ({
        ...c,
        quantity: Math.ceil(c.quantity * (1 + CHARGER_REDUNDANCY_FACTOR)),
        reason: c.reason + ' (with redundancy)'
    }));
    
    return {
        name: 'With Redundancy',
        description: 'Additional chargers for backup and maintenance downtime',
        chargers: chargersWithRedundancy,
        totalCost: calculateTotalChargerCost(chargersWithRedundancy),
        estimatedInstallCost: estimateInstallationCost(chargersWithRedundancy)
    };
}

function calculateTotalChargerCost(chargers) {
    return chargers.reduce((sum, c) => {
        const avgCost = (c.priceRange.min + c.priceRange.max) / 2;
        return sum + (avgCost * c.quantity);
    }, 0);
}

function estimateInstallationCost(chargers) {
    // Rough installation cost estimates
    const costs = {
        '$': 5000,
        '$$': 15000,
        '$$$': 35000,
        '$$$$': 75000
    };
    
    return chargers.reduce((sum, c) => {
        const installCost = costs[c.infrastructureCost] || 10000;
        return sum + (installCost * c.quantity);
    }, 0);
}

// ==========================
// Bus Schedule Management
// ==========================
function addBusSchedule(schedule) {
    busSchedules.push({
        id: nextBusScheduleId++,
        ...schedule
    });
    renderBusSchedules();
}

function editBusSchedule(index, schedule) {
    busSchedules[index] = {
        ...busSchedules[index],
        ...schedule
    };
    renderBusSchedules();
}

function deleteBusSchedule(index) {
    if (confirm('Are you sure you want to delete this bus schedule?')) {
        busSchedules.splice(index, 1);
        renderBusSchedules();
    }
}

function renderBusSchedules() {
    const container = document.getElementById('busSchedulesList');
    
    if (busSchedules.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🚌</div>
                <p>No bus schedules added yet. Click "Add Bus Schedule" to get started.</p>
                <small class="text-muted">Each bus schedule represents one physical bus with all its daily trips.</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = busSchedules.map((schedule, index) => {
        const totalMiles = schedule.trips.reduce((sum, t) => sum + t.miles, 0);
        const maxPassengers = Math.max(...schedule.trips.map(t => t.passengers));
        const firstTrip = schedule.trips[0];
        const lastTrip = schedule.trips[schedule.trips.length - 1];
        const timeRange = `${firstTrip.startTime} - ${lastTrip.endTime}`;

        return `
            <div class="bus-schedule-card">
                <div class="bus-schedule-header">
                    <div>
                        <div class="bus-schedule-title">🚌 ${schedule.name}</div>
                        <div class="bus-schedule-subtitle">${schedule.trips.length} trip${schedule.trips.length > 1 ? 's' : ''} • ${totalMiles} miles • ${timeRange}</div>
                    </div>
                    <div class="bus-schedule-actions">
                        <button class="btn btn-sm btn-secondary" onclick="openEditBusScheduleModal(${index})">Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteBusSchedule(${index})">Delete</button>
                    </div>
                </div>

                <div class="trips-summary">
                    ${schedule.trips.map((trip, tripIdx) => `
                        <div class="trip-summary-item">
                            <span class="trip-number">${tripIdx + 1}</span>
                            <div class="trip-summary-details">
                                <strong>${trip.startLocation || 'Start'} → ${trip.endLocation || 'End'}</strong>
                                <span class="trip-summary-meta">${trip.miles} mi • ${trip.passengers} passengers • ${trip.startTime}-${trip.endTime}</span>
                                ${trip.returnToDepot !== false ? '<span class="depot-indicator">⚡ Returned to Chargers</span>' : '<span class="depot-indicator no-return">No Charging</span>'}
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="bus-schedule-stats">
                    <div class="stat-badge">
                        <span class="stat-label">Total Distance</span>
                        <span class="stat-value">${totalMiles} mi</span>
                    </div>
                    <div class="stat-badge">
                        <span class="stat-label">Max Capacity Needed</span>
                        <span class="stat-value">${maxPassengers} seats</span>
                    </div>
                    <div class="stat-badge">
                        <span class="stat-label">Charging Stops</span>
                        <span class="stat-value">${schedule.trips.filter(t => t.returnToDepot !== false).length}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function saveBusSchedulesToFile() {
    if (busSchedules.length === 0) {
        alert('No bus schedules to save.');
        return;
    }
    
    const data = JSON.stringify(busSchedules, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bus-schedules.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function loadBusSchedulesFromFile(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const loadedSchedules = JSON.parse(e.target.result);
            
            // Basic validation
            if (!Array.isArray(loadedSchedules)) {
                throw new Error('Invalid file format: Expected an array of schedules.');
            }
            
            // Update state
            busSchedules = loadedSchedules;
            
            // Update ID counter to avoid conflicts
            if (busSchedules.length > 0) {
                const maxId = Math.max(...busSchedules.map(s => s.id || 0));
                nextBusScheduleId = maxId + 1;
            }
            
            renderBusSchedules();
            alert(`Successfully loaded ${busSchedules.length} bus schedules.`);
            
        } catch (error) {
            console.error('Error loading file:', error);
            alert('Error loading file: ' + error.message);
        }
        
        // Reset input so same file can be selected again if needed
        input.value = '';
    };
    
    reader.readAsText(file);
}

// ==========================
// Modal Management
// ==========================
let currentEditingScheduleIndex = null;
let modalTrips = []; // Temporary trips being edited in modal

function openAddBusScheduleModal() {
    currentEditingScheduleIndex = null;
    modalTrips = [];
    
    document.getElementById('modalTitle').textContent = 'Add Bus Schedule';
    document.getElementById('busScheduleName').value = `Bus #${busSchedules.length + 1}`;
    
    // Add first trip by default
    addTripToModal(false);
    
    document.getElementById('busScheduleModal').style.display = 'flex';
    
    // Ensure we start at the top
    const modalBody = document.querySelector('#busScheduleModal .modal-body');
    if (modalBody) modalBody.scrollTop = 0;
}

function openEditBusScheduleModal(index) {
    currentEditingScheduleIndex = index;
    const schedule = busSchedules[index];
    modalTrips = [...schedule.trips]; // Clone trips
    
    document.getElementById('modalTitle').textContent = 'Edit Bus Schedule';
    document.getElementById('busScheduleName').value = schedule.name;
    
    renderModalTrips();
    
    document.getElementById('busScheduleModal').style.display = 'flex';
    
    // Ensure we start at the top
    const modalBody = document.querySelector('#busScheduleModal .modal-body');
    if (modalBody) modalBody.scrollTop = 0;
}

function addTripToModal(scrollToNew = true) {
    // Get the last trip to use for smart defaults
    const lastTrip = modalTrips.length > 0 ? modalTrips[modalTrips.length - 1] : null;
    
    let defaultStartLocation = '';
    let defaultStartTime = '07:00';
    
    if (lastTrip) {
        // Start location = previous trip's end location
        defaultStartLocation = lastTrip.endLocation || '';
        
        // Start time = previous trip's end time
        defaultStartTime = lastTrip.endTime || '07:00';
    }
    
    // Add a new trip with smart defaults
    modalTrips.push({
        startLocation: defaultStartLocation,
        endLocation: '',
        miles: 0,
        passengers: lastTrip ? lastTrip.passengers : 0, // Use same passenger count as last trip
        startTime: defaultStartTime,
        endTime: addMinutesToTime(defaultStartTime, 60), // Default to 1 hour after start
        returnToDepot: true,
        notes: ''
    });
    renderModalTrips();
    
    if (scrollToNew) {
        setTimeout(() => {
            const container = document.getElementById('modalTripsContainer');
            const trips = container.querySelectorAll('.modal-trip-form');
            const lastTrip = trips[trips.length - 1];
            if (lastTrip) {
                lastTrip.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }
}

// Helper function to add minutes to a time string (HH:MM format)
function addMinutesToTime(timeString, minutesToAdd) {
    const [hours, minutes] = timeString.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + minutesToAdd;
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMinutes = totalMinutes % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
}

function removeTripFromModal(tripIndex) {
    if (modalTrips.length === 1) {
        alert('A bus schedule must have at least one trip.');
        return;
    }
    modalTrips.splice(tripIndex, 1);
    renderModalTrips();
}

function renderModalTrips() {
    const container = document.getElementById('modalTripsContainer');
    
    const tripsHTML = modalTrips.map((trip, index) => `
        <div class="modal-trip-form" data-trip-index="${index}">
            <div class="modal-trip-header">
                <h4>Trip ${index + 1}</h4>
                ${modalTrips.length > 1 ? `<button type="button" class="btn-icon-only" onclick="removeTripFromModal(${index})">✕</button>` : ''}
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>Start Location</label>
                    <input type="text" value="${trip.startLocation || ''}" 
                           onchange="updateModalTrip(${index}, 'startLocation', this.value)"
                           placeholder="e.g., Depot or School">
                </div>
                <div class="form-group">
                    <label>End Location</label>
                    <input type="text" value="${trip.endLocation || ''}"
                           onchange="updateModalTrip(${index}, 'endLocation', this.value)"
                           placeholder="e.g., School or Last Stop">
                    <div style="margin-top: 8px;">
                        <label style="font-weight: normal; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" ${trip.returnToDepot !== false ? 'checked' : ''}
                                   onchange="updateModalTrip(${index}, 'returnToDepot', this.checked)"
                                   style="width: auto; margin: 0;">
                            <span>Can charge at this location</span>
                        </label>
                    </div>
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>Distance (miles)*</label>
                    <input type="number" value="${trip.miles || ''}" min="0" step="0.1" required
                           onchange="updateModalTrip(${index}, 'miles', parseFloat(this.value) || 0)"
                           placeholder="e.g., 15">
                </div>
                <div class="form-group">
                    <label>Passengers*</label>
                    <input type="number" value="${trip.passengers !== undefined ? trip.passengers : ''}" min="0" required
                           onchange="updateModalTrip(${index}, 'passengers', this.value === '' ? 0 : parseInt(this.value))"
                           placeholder="e.g., 50">
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>Start Time*</label>
                    <input type="time" value="${trip.startTime}" required
                           onchange="updateModalTrip(${index}, 'startTime', this.value)">
                </div>
                <div class="form-group">
                    <label>End Time*</label>
                    <input type="time" value="${trip.endTime}" required
                           onchange="updateModalTrip(${index}, 'endTime', this.value)">
                </div>
            </div>
            
            <div class="form-group">
                <label>Notes</label>
                <textarea rows="2" onchange="updateModalTrip(${index}, 'notes', this.value)"
                          placeholder="Optional notes about this trip...">${trip.notes || ''}</textarea>
            </div>
        </div>
    `).join('');
    
    // Add the "Add Another Trip" button at the bottom
    const addButtonHTML = `
        <div style="text-align: center; margin-top: 20px;">
            <button type="button" class="btn btn-secondary" onclick="addTripToModal()">
                + Add Another Trip
            </button>
        </div>
    `;
    
    container.innerHTML = tripsHTML + addButtonHTML;
}

function updateModalTrip(index, field, value) {
    modalTrips[index][field] = value;
}

function closeModal() {
    document.getElementById('busScheduleModal').style.display = 'none';
    modalTrips = [];
    currentEditingScheduleIndex = null;
}

function saveBusSchedule() {
    const name = document.getElementById('busScheduleName').value.trim();
    
    if (!name) {
        alert('Please enter a bus name.');
        return;
    }
    
    // Validate all trips have required fields
    for (let i = 0; i < modalTrips.length; i++) {
        const trip = modalTrips[i];
        if (!trip.miles || trip.miles <= 0) {
            alert(`Trip ${i + 1}: Please enter a valid distance.`);
            return;
        }
        if (trip.passengers === undefined || trip.passengers === null || trip.passengers < 0) {
            alert(`Trip ${i + 1}: Please enter a valid passenger count (0 or more).`);
            return;
        }
        if (!trip.startTime || !trip.endTime) {
            alert(`Trip ${i + 1}: Please enter start and end times.`);
            return;
        }
    }
    
    // Validate at least one trip has passengers
    const hasPassengers = modalTrips.some(t => t.passengers > 0);
    if (!hasPassengers) {
        alert('At least one trip must have passengers (greater than 0) to justify the route.');
        return;
    }
    
    // Validate at least one trip returns to chargers
    const hasChargerReturn = modalTrips.some(t => t.returnToDepot !== false);
    if (!hasChargerReturn) {
        alert('At least one trip must have "Can charge at this location" checked to ensure the bus can recharge.');
        return;
    }

    const schedule = {
        name,
        trips: modalTrips.map(t => ({...t})), // Clone trips
        selectedBus: null,
        selectedCharger: null
    };
    
    if (currentEditingScheduleIndex !== null) {
        editBusSchedule(currentEditingScheduleIndex, schedule);
    } else {
        addBusSchedule(schedule);
    }
    
    closeModal();
}

// ==========================
// Climate Display Helper
// ==========================
function updateClimateDisplay() {
    const infoDiv = document.getElementById('depotInfo');
    
    if (depotClimate) {
        infoDiv.style.display = 'flex';
        document.getElementById('climateZone').textContent = 
            depotClimate.isColdClimate ? 'Cold (Below Freezing)' : 'Moderate';
        document.getElementById('winterDerating').textContent = 
            depotClimate.isColdClimate ? '30%' : '0%';
    } else {
        infoDiv.style.display = 'none';
    }
}

// ==========================
// Trip Scheduling & Optimization
// ==========================

function addBusGroup() {
    const group = {
        id: nextBusGroupId++,
        name: `Bus ${busGroups.length + 1}`,
        trips: [],
        selectedBus: null,
        selectedCharger: null
    };
    busGroups.push(group);
    displayBusGroups();
}

function autoOptimizeBusGroups() {
    if (trips.length === 0) return;
    
    // Sort trips by start time
    const sortedTrips = trips.map((t, idx) => ({ ...t, originalIndex: idx }))
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    
    busGroups = [];
    nextBusGroupId = 1;
    
    // Greedy algorithm: assign each trip to the first available bus
    for (const trip of sortedTrips) {
        let assigned = false;
        
        // Try to assign to existing bus group
        for (const group of busGroups) {
            if (canAddTripToGroup(group, trip)) {
                group.assignedTripIndices.push(trip.originalIndex);
                assigned = true;
                break;
            }
        }
        
        // If can't fit in any existing group, create new bus
        if (!assigned) {
            busGroups.push({
                id: nextBusGroupId++,
                name: `Bus #${busGroups.length + 1}`,
                assignedTripIndices: [trip.originalIndex],
                selectedBus: null,
                selectedCharger: null
            });
        }
    }
    
    displayBusGroups();
    showOptimizationResults(sortedTrips.length, busGroups.length);
}

function canAddTripToGroup(group, newTrip) {
    const groupTrips = group.assignedTripIndices.map(idx => trips[idx]);
    
    // Check for time conflicts
    const newStart = timeToMinutes(newTrip.startTime);
    const newEnd = timeToMinutes(newTrip.endTime);
    
    for (const existingTrip of groupTrips) {
        const existingStart = timeToMinutes(existingTrip.startTime);
        const existingEnd = timeToMinutes(existingTrip.endTime);
        
        // Check for overlap (with 15-min buffer for safety)
        const buffer = 15;
        if (newStart < existingEnd + buffer && newEnd + buffer > existingStart) {
            return false; // Time conflict
        }
    }
    
    return true; // No conflicts, can add
}

// ==========================
// Bus Selection for Schedules
// ==========================
function toggleBusListForSchedule(scheduleIdx) {
    const container = document.getElementById(`bus-selection-container-for-schedule-${scheduleIdx}`);
    if (container) {
        container.classList.toggle('collapsed');
    }
}

function renderSelectedBusForScheduleCompact(bus, scheduleIdx) {
    const priceMin = bus.priceRange?.min || 0;
    const priceMax = bus.priceRange?.max || 0;
    const priceDisplay = priceMax > 0 
        ? `$${(priceMin / 1000).toFixed(0)}k - $${(priceMax / 1000).toFixed(0)}k`
        : 'Contact for pricing';

    const busTypeDisplay = bus.busType || 'Unknown';
    const schedule = busSchedules[scheduleIdx];
    const considerDegradation = document.getElementById('batteryDegradation').checked;
    const effectiveRange = calculateEffectiveRangeForSchedule(bus, schedule, depotClimate, considerDegradation);

    return `
        <div class="selected-bus-compact" onclick="toggleBusListForSchedule(${scheduleIdx})" title="Click to change selection">
            <div class="selected-bus-compact-content">
                <div>
                    <div class="selected-bus-name">${bus.manufacturer} ${bus.model}</div>
                    <div class="selected-bus-specs-compact">
                        <span>${busTypeDisplay} • ${bus.passengerCapacity} seats</span>
                        <span> • ${bus.batteryCapacity} kWh</span>
                        <span> • ${effectiveRange ? effectiveRange.toFixed(0) : bus.rangeRated} mi est. range</span>
                        <span> • ${priceDisplay}</span>
                    </div>
                </div>
                <div class="selected-bus-action">
                    Change Selection ›
                </div>
            </div>
        </div>
    `;
}

function displayBusSelectionForSchedules() {
    const container = document.getElementById('busSelection');
    const considerDegradation = document.getElementById('batteryDegradation')?.checked;

    // If the legacy container was removed (we now render inline), delegate to renderBusSchedules
    if (!container) {
        renderBusSchedules(true);
        return;
    }

    container.innerHTML = busSchedules.map((schedule, scheduleIdx) => {
        const totalMiles = schedule.trips.reduce((sum, t) => sum + t.miles, 0);
        const maxPassengers = Math.max(...schedule.trips.map(t => t.passengers));

        const compatibleBuses = busesData.filter(bus => {
            if (bus.passengerCapacity < maxPassengers) return false;
            const effectiveRange = calculateEffectiveRangeForSchedule(bus, schedule, depotClimate, considerDegradation);
            return effectiveRange >= totalMiles;
        });

        const isSelected = !!schedule.selectedBus;

        return `
            <div class="bus-schedule-section">
                <h3>${schedule.name}</h3>
                <div class="schedule-summary">
                    <div class="summary-stat">
                        <span class="stat-label">Total Distance</span>
                        <span class="stat-value">${totalMiles} mi</span>
                    </div>
                    <div class="summary-stat">
                        <span class="stat-label">Max Passengers</span>
                        <span class="stat-value">${maxPassengers} seats</span>
                    </div>
                    <div class="summary-stat">
                        <span class="stat-label">Trips</span>
                        <span class="stat-value">${schedule.trips.length}</span>
                    </div>
                </div>

                ${isSelected ? renderSelectedBusForScheduleCompact(schedule.selectedBus, scheduleIdx) : ''}

                <div class="bus-selection-for-group ${isSelected ? 'collapsed' : ''}" id="bus-selection-container-for-schedule-${scheduleIdx}">
                    <div class="bus-filter-section">
                        <h4>Filter Buses:</h4>
                        <div class="bus-filters" data-schedule-index="${scheduleIdx}">
                            <div class="filter-group">
                                <label class="filter-label">Bus Type:</label>
                                <select multiple class="filter-multiselect" data-filter="type" onchange="filterBusesForSchedule(${scheduleIdx})" size="3">
                                    <option value="Type A">Type A</option>
                                    <option value="Type C">Type C</option>
                                    <option value="Type D">Type D</option>
                                </select>
                                <span class="filter-hint">Hold Ctrl/Cmd to select multiple</span>
                            </div>
                            <div class="filter-group">
                                <label class="filter-label">Manufacturer:</label>
                                <select multiple class="filter-multiselect" data-filter="manufacturer" onchange="filterBusesForSchedule(${scheduleIdx})" size="6">
                                    ${[...new Set(compatibleBuses.map(b => b.manufacturer))].sort().map(m => `<option value="${m}">${m}</option>`).join('')}
                                </select>
                                <span class="filter-hint">Hold Ctrl/Cmd to select multiple</span>
                            </div>
                            <div class="filter-group">
                                <label class="filter-label">Charging:</label>
                                <div class="filter-checkboxes">
                                    <label class="filter-checkbox"><input type="checkbox" value="yes" data-filter="dcfc" onchange="filterBusesForSchedule(${scheduleIdx})"><span>Has DCFC</span></label>
                                    <label class="filter-checkbox"><input type="checkbox" value="yes" data-filter="ac" onchange="filterBusesForSchedule(${scheduleIdx})"><span>Has AC Level 2</span></label>
                                </div>
                            </div>
                            <button class="btn btn-sm btn-secondary" onclick="clearFiltersForSchedule(${scheduleIdx})" style="margin-top: 0.5rem;">Clear All Filters</button>
                        </div>
                    </div>

                    <h4>${isSelected ? 'Change Bus:' : 'Select ONE Bus for This Schedule:'}</h4>
                    <div class="bus-cards-grid" id="buses-schedule-${scheduleIdx}" data-all-buses='${JSON.stringify(compatibleBuses).replace(/'/g, "&#39;")}'>
                        ${compatibleBuses.length > 0 ? compatibleBuses.map(bus =>
                            renderBusCardForSchedule(bus, schedule, scheduleIdx, considerDegradation)
                        ).join('') : '<p class="text-muted">No compatible buses found. Try increasing route distance or reducing passenger requirements.</p>'}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    updateFinalizeButtonState();
}

function calculateEffectiveRangeForSchedule(bus, schedule, climate, considerDegradation) {
    // For continuous trips (no depot return), we need full range
    // Find longest continuous segment between depot returns
    let maxContinuousMiles = 0;
    let currentSegmentMiles = 0;
    
    for (const trip of schedule.trips) {
        currentSegmentMiles += trip.miles;
        
        if (trip.returnToDepot !== false) {
            // This trip returns to depot, can charge
            maxContinuousMiles = Math.max(maxContinuousMiles, currentSegmentMiles);
            currentSegmentMiles = 0;
        }
    }
    
    // Check final segment if didn't end with depot return
    maxContinuousMiles = Math.max(maxContinuousMiles, currentSegmentMiles);
    
    // Calculate effective range with climate and degradation
    let effectiveRange = bus.rangeRated;
    
    // Check global settings
    const weatherCheckbox = document.getElementById('considerWeather');
    const terrainCheckbox = document.getElementById('considerTerrain');
    const terrainDropdown = document.getElementById('terrainType');
    
    const useWeather = weatherCheckbox ? weatherCheckbox.checked : true;
    const useTerrain = terrainCheckbox ? terrainCheckbox.checked : false;
    
    // Apply climate derating
    if (useWeather && climate && climate.isColdClimate) {
        effectiveRange *= (1 - RANGE_DERATING_FACTORS.coldClimate);
    }
    
    // Apply battery degradation if enabled
    if (considerDegradation) {
        effectiveRange *= (1 - RANGE_DERATING_FACTORS.batteryDegradation5Year);
    }
    
    // Apply terrain derating
    let terrainToUse = 'flat';
    
    if (useTerrain && terrainDropdown) {
        terrainToUse = terrainDropdown.value;
    }
    
    if (terrainToUse === 'rolling' || terrainToUse === 'hills') {
        effectiveRange *= (1 - RANGE_DERATING_FACTORS.hillsTerrain);
    } else if (terrainToUse === 'mountainous') {
        effectiveRange *= (1 - RANGE_DERATING_FACTORS.mountainousTerrain);
    }
    
    return effectiveRange;
}

function renderBusCardForSchedule(bus, schedule, scheduleIdx, considerDegradation) {
    const totalMiles = schedule.trips.reduce((sum, t) => sum + (t.miles || 0), 0);
    let effectiveRange = calculateEffectiveRangeForSchedule(bus, schedule, depotClimate, considerDegradation);
    
    // Safety check
    if (!effectiveRange || isNaN(effectiveRange)) {
        effectiveRange = bus.rangeRated || 100;
    }
    
    const rangeMargin = effectiveRange - totalMiles;
    const rangePercent = ((totalMiles / effectiveRange) * 100).toFixed(0);
    
    const priceMin = bus.priceRange?.min || 0;
    const priceMax = bus.priceRange?.max || 0;
    const priceDisplay = priceMax > 0 
        ? `$${(priceMin/1000).toFixed(0)}k - $${(priceMax/1000).toFixed(0)}k`
        : 'Contact for pricing';
    
    const isSelected = schedule.selectedBus && schedule.selectedBus.model === bus.model;
    
    // Format charging speeds
    const dcfcSpeed = bus.maxVehicleAcceptanceRate?.dcfc || 'N/A';
    const level2Speed = bus.maxVehicleAcceptanceRate?.level2 || 'N/A';
    
    // Format warranty
    const batteryWarranty = bus.warranty?.battery || 'Contact manufacturer';
    
    return `
        <div class="bus-card ${isSelected ? 'selected' : ''}" 
             onclick="selectBusForSchedule(${scheduleIdx}, ${JSON.stringify(bus).replace(/"/g, '&quot;')})">
            
            <div class="bus-card-header">
                <div>
                    <div class="bus-title">${bus.manufacturer} ${bus.model}</div>
                    <div class="bus-subtitle">${bus.busType} • ${bus.passengerCapacity} seats</div>
                </div>
                <div class="bus-type-badge">${bus.busType}</div>
            </div>
            
            <div class="bus-specs">
                <div class="spec-item">
                    <span class="spec-label">Battery Capacity</span>
                    <span class="spec-value">${bus.batteryCapacity} kWh</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">Rated Range</span>
                    <span class="spec-value">${bus.rangeRated} mi</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">Effective Range</span>
                    <span class="spec-value">${effectiveRange.toFixed(0)} mi</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">Price Range</span>
                    <span class="spec-value">${priceDisplay}</span>
                </div>
            </div>
            
            <div class="bus-specs">
                <div class="spec-item">
                    <span class="spec-label">DC Fast Charging</span>
                    <span class="spec-value">${dcfcSpeed} kW</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">AC Level 2</span>
                    <span class="spec-value">${level2Speed} kW</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">Battery Warranty</span>
                    <span class="spec-value">${batteryWarranty}</span>
                </div>
            </div>
            
            <div class="range-indicator">
                <div class="range-indicator-label">
                    <span>Range Utilization:</span>
                    <span>${rangePercent}% (${totalMiles} mi / ${effectiveRange.toFixed(0)} mi)</span>
                </div>
                <div class="range-bar">
                    <div class="range-fill ${rangePercent > 90 ? 'danger' : rangePercent > 80 ? 'warning' : ''}" 
                         style="width: ${Math.min(rangePercent, 100)}%">
                        ${rangePercent}%
                    </div>
                </div>
                <div style="margin-top: 8px; font-size: 0.875rem; ${rangeMargin < 20 ? 'color: var(--danger-color); font-weight: 600;' : 'color: var(--success-color);'}">
                    ${rangeMargin >= 0 
                        ? `✓ ${rangeMargin.toFixed(0)} mi safety margin` 
                        : `⚠ ${Math.abs(rangeMargin).toFixed(0)} mi SHORT - Choose larger bus`}
                </div>
            </div>
            
            ${isSelected ? '<div class="selected-checkmark">✓ Selected</div>' : '<div class="select-prompt">Click to select this bus</div>'}
        </div>
    `;
}

function selectBusForSchedule(scheduleIdx, bus) {
    busSchedules[scheduleIdx].selectedBus = bus;
    
    // Refresh the bus selection page if on page 3
    if (currentStep === 3) {
        renderBusSelectionPage();
        // Scroll to next unselected schedule
        scrollToNextAction();
    }
}

function toggleBusSelectionForSchedule(scheduleIdx) {
    const expandableSection = document.getElementById(`bus-selection-expandable-${scheduleIdx}`);
    const btn = document.querySelector(`[onclick="toggleBusSelectionForSchedule(${scheduleIdx})"]`);
    
    if (expandableSection) {
        const isHidden = expandableSection.style.display === 'none';
        expandableSection.style.display = isHidden ? 'block' : 'none';
        
        // Update button text
        if (btn) {
            btn.textContent = isHidden ? 'Cancel' : 'Change Selection';
        }
        
        // Clear the selection when expanding to choose again
        if (isHidden) {
            busSchedules[scheduleIdx].selectedBus = null;
            
            // Re-render based on current page to update the UI
            if (currentStep === 3) {
                renderBusSelectionPage();
            } else if (currentStep === 2) {
                renderBusSchedules(true);
            }
        }
    }
}

function scrollToNextAction() {
    // Find first schedule without a selected bus
    const nextUnselectedIdx = busSchedules.findIndex(s => !s.selectedBus);
    
    if (nextUnselectedIdx !== -1) {
        // Scroll to next unselected schedule
        const nextSection = document.querySelectorAll('.bus-schedule-selection-section')[nextUnselectedIdx];
        if (nextSection) {
            setTimeout(() => {
                nextSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 200);
        }
    } else {
        // All selected, scroll to continue button
        const continueBtn = document.getElementById('continueToChargersBtn');
        if (continueBtn) {
            setTimeout(() => {
                continueBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 200);
        }
    }
}

function filterBusesForSchedule(scheduleIdx) {
    const filterContainer = document.querySelector(`.bus-filters[data-schedule-index="${scheduleIdx}"]`);
    // Support both inline and legacy bus-grid IDs
    let busesGrid = document.getElementById(`buses-schedule-inline-${scheduleIdx}`);
    if (!busesGrid) busesGrid = document.getElementById(`buses-schedule-${scheduleIdx}`);
    
    if (!filterContainer || !busesGrid) return;
    
    // Get all buses from data attribute
    const allBuses = JSON.parse(busesGrid.getAttribute('data-all-buses') || '[]');
    
    // Get selected filter values from custom multiselects
    const typeMultiselect = filterContainer.querySelector('.custom-multiselect[data-filter="type"]');
    const mfrMultiselect = filterContainer.querySelector('.custom-multiselect[data-filter="manufacturer"]');
    const chargingMultiselect = filterContainer.querySelector('.custom-multiselect[data-filter="charging"]');
    
    const selectedTypes = typeMultiselect ? Array.from(typeMultiselect.querySelectorAll('input:checked')).map(cb => cb.value) : [];
    const selectedManufacturers = mfrMultiselect ? Array.from(mfrMultiselect.querySelectorAll('input:checked')).map(cb => cb.value) : [];
    const chargingSelected = chargingMultiselect ? Array.from(chargingMultiselect.querySelectorAll('input:checked')).map(cb => cb.value) : [];
    
    const requireDCFC = chargingSelected.includes('dcfc');
    const requireAC = chargingSelected.includes('ac');
    
    // Filter buses
    const filteredBuses = allBuses.filter(bus => {
        // Type filter
        if (selectedTypes.length > 0 && !selectedTypes.includes(bus.busType)) {
            return false;
        }
        
        // Manufacturer filter
        if (selectedManufacturers.length > 0 && !selectedManufacturers.includes(bus.manufacturer)) {
            return false;
        }
        
        // DCFC filter
        if (requireDCFC && (!bus.maxVehicleAcceptanceRate?.dcfc || bus.maxVehicleAcceptanceRate.dcfc === 0)) {
            return false;
        }
        
        // AC filter
        if (requireAC && (!bus.maxVehicleAcceptanceRate?.level2 || bus.maxVehicleAcceptanceRate.level2 === 0)) {
            return false;
        }
        
        return true;
    });
    
    // Sort buses
    const sortInput = document.getElementById(`sort-${scheduleIdx}`);
    const sortValue = sortInput ? sortInput.value : 'price_asc';
    const sortedBuses = sortBuses(filteredBuses, sortValue);

    // Re-render the filtered buses
    const considerDegradation = document.getElementById('batteryDegradation')?.checked;
    const schedule = busSchedules[scheduleIdx];
    
    if (sortedBuses.length > 0) {
        busesGrid.innerHTML = sortedBuses.map(bus => 
            renderBusCardForSchedule(bus, schedule, scheduleIdx, considerDegradation)
        ).join('');
    } else {
        busesGrid.innerHTML = '<p class="text-muted">No buses match the selected filters.</p>';
    }
}

function clearFiltersForSchedule(scheduleIdx) {
    const filterContainer = document.querySelector(`.bus-filters[data-schedule-index="${scheduleIdx}"]`);
    if (!filterContainer) return;
    
    // Clear all checkboxes in multiselects
    filterContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    
    // Reset all multiselect labels
    filterContainer.querySelectorAll('.custom-multiselect').forEach(multiselect => {
        const filterType = multiselect.getAttribute('data-filter');
        const label = multiselect.querySelector('.multiselect-label');
        label.textContent = `Select ${filterType}...`;
        label.classList.remove('has-selection');
    });
    
    // Re-render with all buses
    filterBusesForSchedule(scheduleIdx);
}

// REMOVED: Individual charger selection - now using optimized charger scenarios instead
// Users select buses, then system shows 4 optimized charger scenarios to choose from
// This provides better recommendations based on fleet needs rather than individual selection

function displayBusGroups() {
    const container = document.getElementById('busGroupsContainer');
    
    if (busGroups.length === 0) {
        // Initialize with one bus group
        busGroups.push({
            id: nextBusGroupId++,
            name: `Bus #1`,
            assignedTripIndices: [],
            selectedBus: null,
            selectedCharger: null
        });
    }
    
    container.innerHTML = busGroups.map(group => `
        <div class="bus-group-card" data-group-id="${group.id}">
            <div class="bus-group-header">
                <input type="text" class="bus-group-name-input" value="${group.name}" 
                       onchange="updateBusGroupName(${group.id}, this.value)" placeholder="Bus name">
                <button class="btn btn-sm btn-danger" onclick="removeBusGroup(${group.id})" 
                        ${busGroups.length === 1 ? 'disabled' : ''}>Remove</button>
            </div>
            
            <div class="trip-assignment-section">
                <h4>Assigned Routes:</h4>
                <div class="assigned-trips-list" id="trips-group-${group.id}">
                    ${group.assignedTripIndices.length === 0 ? 
                        '<p class="text-muted">Drag trips here or use checkboxes below</p>' : 
                        group.assignedTripIndices.map(idx => renderAssignedRoute(trips[idx], idx, group.id)).join('')
                    }
                </div>
                
                <div class="trip-stats">
                    <strong>Total Daily Miles:</strong> ${calculateGroupMiles(group)} mi
                </div>
            </div>
            
            <div class="trip-selector">
                <h4>Available Routes:</h4>
                ${trips.map((trip, idx) => `
                    <label class="trip-checkbox">
                        <input type="checkbox" 
                               ${group.assignedTripIndices.includes(idx) ? 'checked' : ''}
                               onchange="toggleTripInGroup(${group.id}, ${idx}, this.checked)">
                        <span>${trip.name} (${trip.startTime}-${trip.endTime}, ${trip.miles} mi)</span>
                    </label>
                `).join('')}
            </div>
            
            <div class="group-actions">
                <button class="btn btn-primary" onclick="proceedToBusSelection()">
                    Continue to Bus Selection →
                </button>
            </div>
        </div>
    `).join('');
}

function renderAssignedRoute(trip, routeIdx, groupId) {
    return `
        <div class="assigned-trip-item">
            <div class="trip-time-badge">${trip.startTime}-${trip.endTime}</div>
            <div class="trip-info">
                <strong>${trip.name}</strong>
                <span>${trip.miles} mi • ${trip.passengers} passengers</span>
            </div>
            <button class="btn-icon" onclick="removeRouteFromGroup(${groupId}, ${routeIdx})" title="Remove">×</button>
        </div>
    `;
}

function calculateGroupMiles(group) {
    return group.assignedTripIndices.reduce((sum, idx) => sum + trips[idx].miles, 0);
}

function toggleTripInGroup(groupId, routeIdx, checked) {
    const group = busGroups.find(g => g.id === groupId);
    if (!group) return;
    
    if (checked) {
        // Remove from other groups first
        busGroups.forEach(g => {
            g.assignedTripIndices = g.assignedTripIndices.filter(idx => idx !== routeIdx);
        });
        // Add to this group
        group.assignedTripIndices.push(routeIdx);
    } else {
        // Remove from this group
        group.assignedTripIndices = group.assignedTripIndices.filter(idx => idx !== routeIdx);
    }
    
    displayBusGroups();
}

function removeRouteFromGroup(groupId, routeIdx) {
    const group = busGroups.find(g => g.id === groupId);
    if (group) {
        group.assignedTripIndices = group.assignedTripIndices.filter(idx => idx !== routeIdx);
        displayBusGroups();
    }
}

function addBusGroup() {
    busGroups.push({
        id: nextBusGroupId++,
        name: `Bus #${busGroups.length + 1}`,
        assignedTripIndices: [],
        selectedBus: null,
        selectedCharger: null
    });
    displayBusGroups();
}

function removeBusGroup(groupId) {
    if (busGroups.length <= 1) return;
    busGroups = busGroups.filter(g => g.id !== groupId);
    displayBusGroups();
}

function updateBusGroupName(groupId, newName) {
    const group = busGroups.find(g => g.id === groupId);
    if (group) {
        group.name = newName;
    }
}

function showOptimizationResults(totalRoutes, busesNeeded) {
    const banner = document.querySelector('.optimization-banner');
    banner.innerHTML = `
        <div class="optimization-result">
            <div class="result-icon">✓</div>
            <div class="result-content">
                <strong>Optimization Complete!</strong>
                <p>Your ${totalRoutes} trips can be served by ${busesNeeded} bus${busesNeeded > 1 ? 'es' : ''}.</p>
                <p class="text-muted">Review the groupings below and adjust if needed.</p>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="autoOptimizeBusGroups()">Re-optimize</button>
        </div>
    `;
}

function proceedToBusSelection() {
    // Validate that all trips are assigned
    const assignedRoutes = new Set();
    busGroups.forEach(group => {
        group.assignedTripIndices.forEach(idx => assignedRoutes.add(idx));
    });
    
    if (assignedRoutes.size !== trips.length) {
        alert('Please assign all trips to buses before continuing.');
        return;
    }
    
    // Hide scheduling section, show bus selection (guard in case legacy section removed)
    const tripSchedulingSection = document.getElementById('tripSchedulingSection');
    if (tripSchedulingSection) tripSchedulingSection.style.display = 'none';
    const busSelectionSection = document.getElementById('busSelectionSection');
    if (busSelectionSection) busSelectionSection.style.display = 'block';
    
    // Display bus selection for each group
    displayBusSelectionForGroups();
    
    // Scroll to bus selection (if present)
    if (busSelectionSection) busSelectionSection.scrollIntoView({ behavior: 'smooth' });
}

function displayBusSelectionForGroups() {
    const container = document.getElementById('busSelection');
    const considerDegradation = document.getElementById('batteryDegradation').checked;
    
    container.innerHTML = busGroups.map(group => {
        const groupRoutes = group.assignedTripIndices.map(idx => trips[idx]);
        const totalMiles = groupRoutes.reduce((sum, r) => sum + r.miles, 0);
        
        // Find compatible buses for this group's requirements
        const maxPassengers = Math.max(...groupRoutes.map(r => r.passengers));
        const compatibleBuses = busesData.filter(bus => {
            // Check passenger capacity
            if (bus.passengerCapacity < maxPassengers) return false;
            
            // Check if bus can handle total daily miles
            const effectiveRange = calculateEffectiveRangeForGroup(bus, groupRoutes, depotClimate, considerDegradation);
            return effectiveRange >= totalMiles * 0.8; // 80% threshold for flexibility
        });
        
        return `
            <div class="bus-group-selection-card">
                <div class="bus-group-selection-header">
                    <h3>${group.name}</h3>
                    <div class="group-summary">
                        <span>${groupRoutes.length} trip${groupRoutes.length > 1 ? 's' : ''}</span>
                        <span>•</span>
                        <span>${totalMiles} total miles/day</span>
                        <span>•</span>
                        <span>Max ${maxPassengers} passengers</span>
                    </div>
                </div>
                
                <div class="assigned-trips-summary">
                    ${groupRoutes.map(r => `
                        <div class="trip-pill">
                            ${r.name} <span class="trip-time">${r.startTime}-${r.endTime}</span>
                        </div>
                    `).join('')}
                </div>
                
                ${group.selectedBus ? renderSelectedBusForGroup(group) : ''}
                
                <div class="bus-selection-for-group ${group.selectedBus ? 'collapsed' : ''}" id="bus-selection-group-${group.id}">
                    <h4>Select Bus Model (${compatibleBuses.length} compatible):</h4>
                    
                    <div class="bus-grid">
                        ${compatibleBuses.slice(0, 10).map(bus => renderBusCardForGroup(bus, group, groupRoutes, considerDegradation)).join('')}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    updateFinalizeButtonState();
}

function calculateEffectiveRangeForGroup(bus, groupRoutes, climate, considerDegradation) {
    // Use the most restrictive trip for calculation
    const worstCaseRoute = groupRoutes.reduce((worst, current) => {
        return current.terrain === 'mountainous' || (current.stops || 0) > (worst.stops || 0) ? current : worst;
    }, groupRoutes[0]);
    
    return calculateEffectiveRange(bus, worstCaseRoute, climate, considerDegradation);
}

function renderBusCardForGroup(bus, group, groupRoutes, considerDegradation) {
    const totalMiles = groupRoutes.reduce((sum, r) => sum + r.miles, 0);
    const effectiveRange = calculateEffectiveRangeForGroup(bus, groupRoutes, depotClimate, considerDegradation);
    const rangeMargin = effectiveRange - totalMiles;
    const rangePercent = ((totalMiles / effectiveRange) * 100).toFixed(0);
    
    const priceMin = bus.priceRange?.min || 0;
    const priceMax = bus.priceRange?.max || 0;
    const priceDisplay = priceMax > 0 
        ? `$${(priceMin/1000).toFixed(0)}k - $${(priceMax/1000).toFixed(0)}k`
        : 'Contact for pricing';
    
    const isSelected = group.selectedBus && group.selectedBus.model === bus.model;
    
    // Format charging speeds
    const dcfcSpeed = bus.maxVehicleAcceptanceRate?.dcfc || 'N/A';
    const level2Speed = bus.maxVehicleAcceptanceRate?.level2 || 'N/A';
    
    // Format warranty
    const batteryWarranty = bus.warranty?.battery || 'Contact manufacturer';
    const vehicleWarranty = bus.warranty?.vehicle || 'Contact manufacturer';
    
    return `
        <div class="bus-card ${isSelected ? 'selected' : ''}" 
             onclick="selectBusForGroup(${group.id}, ${JSON.stringify(bus).replace(/"/g, '&quot;')})">
            
            <div class="bus-card-header">
                <div>
                    <div class="bus-title">${bus.manufacturer} ${bus.model}</div>
                    <div class="bus-subtitle">${bus.busType} • ${bus.passengerCapacity} seats</div>
                </div>
                <div class="bus-type-badge">${bus.busType}</div>
            </div>
            
            <div class="bus-specs">
                <div class="spec-item">
                    <span class="spec-label">Battery Capacity</span>
                    <span class="spec-value">${bus.batteryCapacity} kWh</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">Rated Range</span>
                    <span class="spec-value">${bus.rangeRated} mi</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">Effective Range</span>
                    <span class="spec-value">${effectiveRange} mi</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">Price Range</span>
                    <span class="spec-value">${priceDisplay}</span>
                </div>
            </div>
            
            <div class="bus-specs">
                <div class="spec-item">
                    <span class="spec-label">DC Fast Charging</span>
                    <span class="spec-value">${dcfcSpeed} kW</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">AC Level 2</span>
                    <span class="spec-value">${level2Speed} kW</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">Battery Warranty</span>
                    <span class="spec-value">${batteryWarranty}</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">Vehicle Warranty</span>
                    <span class="spec-value">${vehicleWarranty}</span>
                </div>
            </div>
            
            <div class="range-indicator">
                <div class="range-indicator-label">
                    <span>Range Utilization:</span>
                    <span>${rangePercent}% (${totalMiles} mi / ${effectiveRange} mi)</span>
                </div>
                <div class="range-bar">
                    <div class="range-fill ${rangePercent > 90 ? 'danger' : rangePercent > 80 ? 'warning' : ''}" 
                         style="width: ${Math.min(rangePercent, 100)}%">
                        ${rangePercent}%
                    </div>
                </div>
                <div style="margin-top: 8px; font-size: 0.875rem; ${rangeMargin < 20 ? 'color: var(--danger-color); font-weight: 600;' : 'color: var(--success-color);'}">
                    ${rangeMargin >= 0 
                        ? `✓ ${rangeMargin.toFixed(0)} mi safety margin` 
                        : `⚠ ${Math.abs(rangeMargin).toFixed(0)} mi SHORT - Choose larger bus`}
                </div>
            </div>
            
            ${isSelected ? '<div class="selected-checkmark">✓ Selected</div>' : '<div class="select-prompt">Click to select this bus</div>'}
        </div>
    `;
}

function selectBusForGroup(groupId, bus) {
    const group = busGroups.find(g => g.id === groupId);
    if (!group) return;
    
    group.selectedBus = bus;
    
    // Re-render to show selection and charger options
    displayBusSelectionForGroups();
}

function displayChargerSelectionForGroup(group) {
    const groupRoutes = group.assignedTripIndices.map(idx => trips[idx]);
    const bus = group.selectedBus;
    
    if (!bus) return '';
    
    // Analyze charging requirements
    const chargingAnalysis = analyzeChargingRequirements(bus, groupRoutes);
    
    return `
        <div class="charger-selection-section">
            <h4>Select Charger Type:</h4>
            
            <div class="charging-timeline">
                <strong>Daily Schedule:</strong>
                ${renderChargingTimeline(groupRoutes, bus, null)}
            </div>
            
            <div class="charger-options">
                ${chargersData.map(charger => {
                    const validation = validateCharger(charger, bus, groupRoutes, chargingAnalysis);
                    return renderChargerOption(charger, group, validation);
                }).join('')}
            </div>
        </div>
    `;
}

function analyzeChargingRequirements(bus, trips) {
    const sortedTrips = [...trips].sort((a, b) => 
        timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
    );
    
    const energyPerMile = bus.batteryCapacity / bus.rangeRated;
    let cumulativeMiles = 0;
    let cumulativeEnergy = 0;
    const chargingWindows = [];
    
    for (let i = 0; i < sortedTrips.length; i++) {
        const trip = sortedTrips[i];
        cumulativeMiles += trip.miles;
        const tripEnergy = trip.miles * energyPerMile;
        cumulativeEnergy += tripEnergy;
        
        const stateOfCharge = ((bus.batteryCapacity - cumulativeEnergy) / bus.batteryCapacity) * 100;
        
        // CRITICAL: Only charge if this trip returns to depot!
        if (trip.returnToDepot !== false && i < sortedTrips.length - 1) {
            const nextTrip = sortedTrips[i + 1];
            const gapMinutes = timeToMinutes(nextTrip.startTime) - timeToMinutes(trip.endTime);
            
            chargingWindows.push({
                afterTrip: trip.name,
                beforeTrip: nextTrip.name,
                gapMinutes: gapMinutes,
                energyNeeded: cumulativeEnergy, // Energy to replenish
                stateOfCharge: stateOfCharge,
                canCharge: true // This trip returns to depot
            });
            
            // Reset cumulative energy after charging at depot
            cumulativeEnergy = 0;
            cumulativeMiles = 0;
        }
    }
    
    return {
        totalMiles: trips.reduce((sum, r) => sum + r.miles, 0),
        totalEnergy: trips.reduce((sum, r) => sum + (r.miles * energyPerMile), 0),
        chargingWindows,
        needsMidDayCharging: chargingWindows.length > 0, // Need charging if there are any depot returns
        finalStateOfCharge: ((bus.batteryCapacity - cumulativeEnergy) / bus.batteryCapacity) * 100
    };
}

function validateCharger(charger, bus, trips, analysis) {
    const warnings = [];
    const chargerPower = charger.powerOutput || 50;
    
    // Check each charging window (only exists for trips that return to depot)
    for (const window of analysis.chargingWindows) {
        const chargingTimeNeeded = (window.energyNeeded / chargerPower) * 60; // minutes
        
        if (chargingTimeNeeded > window.gapMinutes) {
            warnings.push({
                type: 'insufficient_time',
                message: `Not enough time at depot between "${window.afterTrip}" and "${window.beforeTrip}". ` +
                         `Need ${Math.ceil(chargingTimeNeeded)} min to charge, have ${window.gapMinutes} min available.`
            });
        } else {
            warnings.push({
                type: 'success',
                message: `✓ ${window.gapMinutes} min at depot: enough to charge ${window.energyNeeded.toFixed(1)} kWh`
            });
        }
    }
    
    // Warn about final state of charge if no depot return at end
    if (analysis.finalStateOfCharge < 20) {
        warnings.push({
            type: 'low_charge',
            message: `⚠ Ends day at ${analysis.finalStateOfCharge.toFixed(0)}% charge. Ensure overnight charging.`
        });
    }
    
    return {
        suitable: !warnings.some(w => w.type === 'insufficient_time'),
        warnings,
        chargingTimeNeeded: analysis.needsMidDayCharging ? 
            Math.ceil((analysis.totalEnergy / chargerPower) * 60) : 0
    };
}

function renderChargerOption(charger, group, validation) {
    const isSelected = group.selectedCharger && group.selectedCharger.name === charger.name;
    const priceDisplay = charger.equipmentCost ? `$${(charger.equipmentCost/1000).toFixed(1)}k` : 'N/A';
    
    return `
        <div class="charger-option ${isSelected ? 'selected' : ''} ${!validation.suitable ? 'unsuitable' : ''}"
             onclick="selectChargerForGroup(${group.id}, ${JSON.stringify(charger).replace(/"/g, '&quot;')})">
            <div class="charger-header">
                <strong>${charger.name}</strong>
                <span class="charger-power">${charger.powerOutput} kW</span>
            </div>
            <div class="charger-price">${priceDisplay} per unit</div>
            
            ${validation.suitable ? 
                `<div class="validation-success">✓ Sufficient for your schedule</div>` :
                `<div class="validation-warnings">
                    ${validation.warnings.map(w => `<div class="warning-item">⚠️ ${w.message}</div>`).join('')}
                </div>`
            }
            
            ${isSelected ? '<div class="selected-checkmark">✓</div>' : ''}
        </div>
    `;
}

function selectChargerForGroup(groupId, charger) {
    const group = busGroups.find(g => g.id === groupId);
    if (!group) return;
    
    group.selectedCharger = charger;
    displayBusSelectionForGroups();
}

function renderSelectedBusForGroup(group) {
    const bus = group.selectedBus;
    const groupRoutes = group.assignedTripIndices.map(idx => trips[idx]);
    const totalMiles = groupRoutes.reduce((sum, r) => sum + r.miles, 0);
    
    return `
        <div class="selected-bus-for-group">
            <div class="selected-label">Selected Bus:</div>
            <div class="selected-bus-info">
                <strong>${bus.manufacturer} ${bus.model}</strong>
                <span>${bus.busType} • ${bus.passengerCapacity} seats • ${bus.batteryCapacity} kWh</span>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="changeBusForGroup(${group.id})">Change</button>
        </div>
    `;
}

function changeBusForGroup(groupId) {
    const selectionDiv = document.getElementById(`bus-selection-group-${groupId}`);
    if (selectionDiv) {
        selectionDiv.classList.toggle('collapsed');
    }
}

function updateFinalizeButtonState() {
    const allBusesSelected = busSchedules.every(s => s.selectedBus);
    const btn = document.getElementById('finalizeSelectionBtn');
    const status = document.getElementById('selectionStatus');
    
    btn.disabled = !allBusesSelected;
    
    if (allBusesSelected) {
        btn.classList.add('btn-pulse');
        status.textContent = '✓ All buses selected. Ready to view optimized charger recommendations!';
        status.style.color = 'var(--success-color)';
    } else {
        btn.classList.remove('btn-pulse');
        const remaining = busSchedules.filter(s => !s.selectedBus).length;
        status.textContent = `Select buses for ${remaining} more schedule${remaining > 1 ? 's' : ''} to continue`;
        status.style.color = 'var(--text-muted)';
    }
}

function showSchedulesForEdit() {
    const controls = document.getElementById('selectionControls');
    if (controls) controls.style.display = 'none';

    const calcBtn = document.getElementById('calculateBtn');
    if (calcBtn) calcBtn.style.display = 'inline-block';

    const schedules = document.getElementById('busSchedulesList');
    if (schedules) schedules.scrollIntoView({ behavior: 'smooth' });
}

// ==========================
// Bus Selection UI (Integrated with Routes)
// ==========================
function displayBusSelection(allCompatibleBuses, trips, climate, considerDegradation) {
    const container = document.getElementById('busSelection');
    
    // Group compatible buses by trip
    const routeBusCompatibility = trips.map((trip, idx) => {
        const compatibleForRoute = allCompatibleBuses.filter(bus => {
            const routeCompatibility = checkBusCompatibility(bus, [trip], climate, considerDegradation);
            return routeCompatibility.compatible;
        });
        
        return {
            trip,
            routeIndex: idx,
            compatibleBuses: compatibleForRoute.map(bus => ({
                ...bus,
                effectiveRange: calculateEffectiveRange(bus, trip, climate, considerDegradation)
            }))
        };
    });
    
    updateSelectionStatus();
    
    // Display selection UI for each trip
    container.innerHTML = routeBusCompatibility.map(({ trip, routeIndex, compatibleBuses }) => {
        if (compatibleBuses.length === 0) {
            return `
                <div class="trip-bus-selection">
                    <div class="trip-info-header">
                        <div>
                            <h3>${trip.name}</h3>
                            <div class="trip-details">
                                <span>📏 ${trip.miles} miles</span>
                                <span>👥 ${trip.passengers} passengers</span>
                                <span>⏰ ${trip.startTime} - ${trip.endTime}</span>
                            </div>
                        </div>
                    </div>
                    <div class="alert alert-warning">
                        ⚠️ No compatible buses found for this trip. Consider adjusting trip parameters.
                    </div>
                </div>
            `;
        }
        
        // Calculate trip requirements and derating factors
        const deratingFactors = [];
        let totalDerating = 0;
        
        if (climate && climate.isColdClimate) {
            deratingFactors.push('❄️ Cold climate: -30%');
            totalDerating += 30;
        }
        
        if (trip.terrain === 'hills') {
            deratingFactors.push('🏔️ Rolling hills: -15%');
            totalDerating += 15;
        } else if (trip.terrain === 'mountainous') {
            deratingFactors.push('⛰️ Mountainous: -25%');
            totalDerating += 25;
        }
        
        if (trip.stops > 0) {
            const stopsDerating = (trip.stops * RANGE_DERATING_FACTORS.stopsPenalty * 100).toFixed(1);
            deratingFactors.push(`🚏 ${trip.stops} stops: -${stopsDerating}%`);
            totalDerating += parseFloat(stopsDerating);
        }
        
        if (considerDegradation) {
            deratingFactors.push('🔋 5-year degradation: -10%');
            totalDerating += 10;
        }
        
        const currentSelection = selectedBuses[routeIndex];
        const hasSelection = !!currentSelection;
        
        return `
            <div class="trip-bus-selection ${hasSelection ? 'has-selection' : ''}" data-trip-index="${routeIndex}">
                <div class="trip-info-header">
                    <div>
                        <h3>${trip.name}</h3>
                        <div class="trip-details">
                            <span>📏 ${trip.miles} miles</span>
                            <span>👥 ${trip.passengers} passengers</span>
                            <span>🚏 ${trip.stops || 0} stops</span>
                            <span>⏰ ${trip.startTime} - ${trip.endTime}</span>
                            <span>🏔️ ${trip.terrain.charAt(0).toUpperCase() + trip.terrain.slice(1)}</span>
                        </div>
                    </div>
                    <div>
                        <span class="badge badge-success">${compatibleBuses.length} Compatible</span>
                    </div>
                </div>
                
                ${hasSelection ? renderSelectedBusCompact(currentSelection, routeIndex) : ''}
                
                <div class="buses-list-container ${hasSelection ? 'buses-collapsed' : ''}" id="buses-container-${routeIndex}">
                    
                    ${!hasSelection && deratingFactors.length > 0 ? `
                    <div class="trip-analysis">
                        <h4>Range Derating Analysis</h4>
                        <div class="derating-factors">
                            ${deratingFactors.map(factor => `<span class="derating-factor">${factor}</span>`).join('')}
                        </div>
                        <div class="total-derating">
                            <strong>Total Range Reduction:</strong> ${totalDerating.toFixed(1)}%
                            <span class="derating-note">Buses shown below have sufficient range after accounting for these factors.</span>
                        </div>
                    </div>
                    ` : ''}
                    <div class="bus-filter-section">
                        <p class="text-muted" style="margin-bottom: 0.75rem;"><strong>Filter buses:</strong></p>
                        <div class="bus-filters" data-trip-index="${routeIndex}">
                            <div class="filter-group">
                                <label class="filter-label">Bus Type:</label>
                                <select multiple class="filter-multiselect" data-filter="type" onchange="filterBuses(${routeIndex})" size="3">
                                    <option value="Type A">Type A</option>
                                    <option value="Type C">Type C</option>
                                    <option value="Type D">Type D</option>
                                </select>
                                <span class="filter-hint">Hold Ctrl/Cmd to select multiple</span>
                            </div>
                            
                            <div class="filter-group">
                                <label class="filter-label">Manufacturer:</label>
                                <select multiple class="filter-multiselect" data-filter="manufacturer" onchange="filterBuses(${routeIndex})" size="6">
                                    ${[...new Set(compatibleBuses.map(b => b.manufacturer))].sort().map(m => 
                                        `<option value="${m}">${m}</option>`
                                    ).join('')}
                                </select>
                                <span class="filter-hint">Hold Ctrl/Cmd to select multiple</span>
                            </div>
                            
                            <div class="filter-group">
                                <label class="filter-label">Charging:</label>
                                <div class="filter-checkboxes">
                                    <label class="filter-checkbox">
                                        <input type="checkbox" value="yes" data-filter="dcfc" onchange="filterBuses(${routeIndex})">
                                        <span>Has DCFC</span>
                                    </label>
                                    <label class="filter-checkbox">
                                        <input type="checkbox" value="yes" data-filter="ac" onchange="filterBuses(${routeIndex})">
                                        <span>Has AC Level 2</span>
                                    </label>
                                </div>
                            </div>
                            
                            <button class="btn btn-sm btn-secondary" onclick="clearFilters(${routeIndex})" style="margin-top: 0.5rem;">Clear All Filters</button>
                        </div>
                    </div>
                    
                    <p class="text-muted" style="margin-bottom: 1rem; margin-top: 1rem;"><strong>Select ONE bus for this trip:</strong></p>
                    <div class="compatible-buses-grid" id="buses-trip-${routeIndex}">
                    ${compatibleBuses.map(bus => {
                        const isSelected = selectedBuses[routeIndex]?.model === bus.model;
                        const priceMin = bus.priceRange?.min || 0;
                        const priceMax = bus.priceRange?.max || 0;
                        const priceDisplay = priceMax > 0 
                            ? `$${(priceMin/1000).toFixed(0)}k - $${(priceMax/1000).toFixed(0)}k`
                            : 'Contact for pricing';
                        
                                // Get charging speeds from maxVehicleAcceptanceRate
                        const dcfcSpeed = bus.maxVehicleAcceptanceRate?.dcfc 
                            ? `${bus.maxVehicleAcceptanceRate.dcfc} kW` 
                            : 'Not specified';
                        const acSpeed = bus.maxVehicleAcceptanceRate?.level2 
                            ? `${bus.maxVehicleAcceptanceRate.level2} kW` 
                            : 'Not specified';
                        const warranty = bus.warranty?.battery || bus.warranty?.vehicle || 'Contact manufacturer';
                        
                        // Determine bus type from busType field
                        const busTypeDisplay = bus.busType || 'Unknown';
                        
                        return `
                            <div class="selectable-bus-card ${isSelected ? 'selected' : ''}" 
                                 data-trip-index="${routeIndex}"
                                 data-bus-model="${bus.model}"
                                 data-manufacturer="${bus.manufacturer}"
                                 data-bus-type="${busTypeDisplay}"
                                 data-has-dcfc="${bus.maxVehicleAcceptanceRate?.dcfc ? 'yes' : 'no'}"
                                 data-has-ac="${bus.maxVehicleAcceptanceRate?.level2 ? 'yes' : 'no'}"
                                 onclick="selectBusForRoute(${routeIndex}, ${JSON.stringify(bus).replace(/"/g, '&quot;')})">
                                <div class="bus-selection-name">
                                    ${bus.manufacturer} ${bus.model}
                                </div>
                                <div class="bus-selection-specs">
                                    <span><strong>Type:</strong> ${busTypeDisplay} • ${bus.passengerCapacity} seats</span>
                                    <span><strong>Battery:</strong> ${bus.batteryCapacity} kWh</span>
                                    <span><strong>GVWR:</strong> ${bus.gvwr.toLocaleString()} lbs</span>
                                    <span><strong>Rated Range:</strong> ${bus.rangeRated} mi</span>
                                    <span><strong>Effective Range:</strong> ${bus.effectiveRange ? bus.effectiveRange.toFixed(0) : bus.rangeRated} mi (for this trip)</span>
                                    <span><strong>DC Fast Charge:</strong> ${dcfcSpeed}</span>
                                    <span><strong>AC Level 2:</strong> ${acSpeed}</span>
                                    <span><strong>Warranty:</strong> ${warranty}</span>
                                </div>
                                <div class="bus-selection-cost">
                                    ${priceDisplay}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Show bus selection section, hide others (guard busSelectionSection in case it's removed)
    const busSelectionSection = document.getElementById('busSelectionSection');
    if (busSelectionSection) busSelectionSection.style.display = 'block';
    document.getElementById('fleetSummarySection').style.display = 'none';
    document.getElementById('selectedBusesSection').style.display = 'none';
    document.getElementById('chargerSection').style.display = 'none';
    document.getElementById('costChartSection').style.display = 'none';
    document.getElementById('rangeChartSection').style.display = 'none';
    document.getElementById('timelineChartSection').style.display = 'none';
}

function renderSelectedBusCompact(bus, routeIndex) {
    const priceMin = bus.priceRange?.min || 0;
    const priceMax = bus.priceRange?.max || 0;
    const priceDisplay = priceMax > 0 
        ? `$${(priceMin/1000).toFixed(0)}k - $${(priceMax/1000).toFixed(0)}k`
        : 'Contact for pricing';
    
    const busTypeDisplay = bus.busType || 'Unknown';
    
    return `
        <div class="selected-bus-compact" onclick="toggleBusList(${routeIndex})" title="Click to change selection">
            <div class="selected-bus-compact-content">
                <div>
                    <div class="selected-bus-name">${bus.manufacturer} ${bus.model}</div>
                    <div class="selected-bus-specs-compact">
                        <span>${busTypeDisplay} • ${bus.passengerCapacity} seats</span>
                        <span>${bus.batteryCapacity} kWh</span>
                        <span>${bus.effectiveRange ? bus.effectiveRange.toFixed(0) : bus.rangeRated} mi range</span>
                        <span>${priceDisplay}</span>
                    </div>
                </div>
                <div class="selected-bus-action">
                    Click to change ›
                </div>
            </div>
        </div>
        <button class="show-buses-toggle" onclick="event.stopPropagation(); toggleBusList(${routeIndex})">
            <span id="toggle-text-${routeIndex}">Change Selection</span>
        </button>
    `;
}

function toggleBusList(routeIndex) {
    const container = document.getElementById(`buses-container-${routeIndex}`);
    const toggleBtn = document.querySelector(`#toggle-text-${routeIndex}`);
    const routeContainer = document.querySelector(`.trip-bus-selection[data-trip-index="${routeIndex}"]`);
    
    if (container.classList.contains('buses-collapsed')) {
        container.classList.remove('buses-collapsed');
        if (toggleBtn) toggleBtn.textContent = 'Hide Options';
        
        // Show range derating analysis when reopening
        if (routeContainer) {
            const analysisSection = container.querySelector('.trip-analysis');
            if (analysisSection) {
                analysisSection.style.display = 'block';
            }
        }
        
        // Make sure selected bus card shows as selected
        const currentSelection = selectedBuses[routeIndex];
        if (currentSelection) {
            setTimeout(() => {
                const busGrid = document.getElementById(`buses-trip-${routeIndex}`);
                const cards = busGrid.querySelectorAll('.selectable-bus-card');
                cards.forEach(card => {
                    const busModel = card.getAttribute('data-bus-model');
                    if (busModel === currentSelection.model) {
                        card.classList.add('selected');
                    } else {
                        card.classList.remove('selected');
                    }
                });
            }, 50);
        }
    } else {
        container.classList.add('buses-collapsed');
        if (toggleBtn) toggleBtn.textContent = 'Change Selection';
    }
}

function updateSelectionStatus() {
    const statusEl = document.getElementById('selectionStatus');
    const selectedCount = Object.keys(selectedBuses).length;
    const totalCount = trips.length;
    
    if (selectedCount === totalCount) {
        statusEl.innerHTML = `✓ All ${totalCount} trip(s) have bus selections. Ready to calculate!`;
        statusEl.style.color = 'var(--success-color)';
    } else {
        statusEl.innerHTML = `${selectedCount} of ${totalCount} trip(s) selected. Select buses for remaining trips.`;
        statusEl.style.color = 'var(--text-muted)';
    }
}

function filterBuses(routeIndex) {
    const filterContainer = document.querySelector(`.bus-filters[data-trip-index="${routeIndex}"]`);
    
    // Get selected values from multi-select dropdowns
    const typeSelect = filterContainer.querySelector('[data-filter="type"]');
    const manufacturerSelect = filterContainer.querySelector('[data-filter="manufacturer"]');
    
    const selectedTypes = Array.from(typeSelect.selectedOptions).map(opt => opt.value);
    const selectedManufacturers = Array.from(manufacturerSelect.selectedOptions).map(opt => opt.value);
    
    // Get checkbox values for charging filters
    const hasDcfcChecked = filterContainer.querySelector('[data-filter="dcfc"]:checked') !== null;
    const hasAcChecked = filterContainer.querySelector('[data-filter="ac"]:checked') !== null;
    
    const busGrid = document.getElementById(`buses-trip-${routeIndex}`);
    const allCards = busGrid.querySelectorAll('.selectable-bus-card');
    
    let visibleCount = 0;
    
    allCards.forEach(card => {
        let show = true;
        
        // Type filter - show if ANY selected type matches (OR logic)
        if (selectedTypes.length > 0) {
            show = selectedTypes.includes(card.dataset.busType);
        }
        
        // Manufacturer filter - show if ANY selected manufacturer matches (OR logic)
        if (show && selectedManufacturers.length > 0) {
            show = selectedManufacturers.includes(card.dataset.manufacturer);
        }
        
        // DCFC filter - must have DCFC if checkbox is checked
        if (show && hasDcfcChecked) {
            show = card.dataset.hasDcfc === 'yes';
        }
        
        // AC filter - must have AC Level 2 if checkbox is checked
        if (show && hasAcChecked) {
            show = card.dataset.hasAc === 'yes';
        }
        
        card.style.display = show ? '' : 'none';
        if (show) visibleCount++;
    });
    
    // Show message if no buses match filters
    let noResultsMsg = busGrid.querySelector('.no-filter-results');
    if (visibleCount === 0) {
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('div');
            noResultsMsg.className = 'no-filter-results';
            noResultsMsg.innerHTML = '<p style="text-align: center; padding: 2rem; color: #5b616b;">No buses match the selected filters. Try adjusting your criteria.</p>';
            busGrid.appendChild(noResultsMsg);
        }
    } else {
        if (noResultsMsg) {
            noResultsMsg.remove();
        }
    }
    
    // Update filter count display
    updateFilterCount(routeIndex, selectedTypes.length + selectedManufacturers.length + (hasDcfcChecked ? 1 : 0) + (hasAcChecked ? 1 : 0));
}

function clearFilters(routeIndex) {
    const filterContainer = document.querySelector(`.bus-filters[data-trip-index="${routeIndex}"]`);
    
    // Clear multi-select dropdowns
    const selects = filterContainer.querySelectorAll('select[multiple]');
    selects.forEach(select => {
        Array.from(select.options).forEach(opt => opt.selected = false);
    });
    
    // Clear checkboxes
    const checkboxes = filterContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    
    filterBuses(routeIndex);
}

function updateFilterCount(routeIndex, count) {
    const clearBtn = document.querySelector(`.bus-filters[data-trip-index="${routeIndex}"] .btn-secondary`);
    if (clearBtn) {
        if (count > 0) {
            clearBtn.textContent = `Clear All Filters (${count})`;
            clearBtn.style.fontWeight = '600';
        } else {
            clearBtn.textContent = 'Clear All Filters';
            clearBtn.style.fontWeight = '400';
        }
    }
}

function selectBusForRoute(routeIndex, bus) {
    // Store selection
    selectedBuses[routeIndex] = bus;
    
    // Re-render the entire bus selection to show compact view
    // Get current results and re-display
    if (currentResults) {
        displayBusSelection(currentResults.buses, trips, depotClimate, currentResults.degradation);
    }
    
    // Update status
    updateSelectionStatus();
    
    // Check if all trips have selections
    const allRoutesSelected = trips.every((_, idx) => selectedBuses[idx]);
    const finalizeBtn = document.getElementById('finalizeSelectionBtn');
    
    if (allRoutesSelected) {
        finalizeBtn.classList.add('btn-pulse');
        finalizeBtn.innerHTML = `✓ Calculate Chargers & View Results`;
        finalizeBtn.disabled = false;
    } else {
        finalizeBtn.classList.remove('btn-pulse');
        finalizeBtn.innerHTML = `Calculate Chargers & View Results`;
        finalizeBtn.disabled = true;
    }
    
    // Smooth scroll to next unselected trip or to the finalize button
    const nextUnselectedIndex = trips.findIndex((_, idx) => !selectedBuses[idx]);
    if (nextUnselectedIndex !== -1) {
        const nextRouteElement = document.querySelector(`.trip-bus-selection[data-trip-index="${nextUnselectedIndex}"]`);
        if (nextRouteElement) {
            setTimeout(() => {
                nextRouteElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    } else {
        // All selected, scroll to finalize button
        setTimeout(() => {
            finalizeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
    }
}

function finalizeSelection() {
    console.log('finalizeSelection() called');
    console.log('busSchedules:', busSchedules);
    
    try {
        // Check if all schedules have bus selections
        const allBusesSelected = busSchedules.every(s => s.selectedBus);
        
        if (!allBusesSelected) {
            alert('Please select a bus for each schedule before finalizing.');
            return;
        }
    } catch (error) {
        console.error('Error in finalizeSelection:', error);
        alert('Error: ' + error.message);
        return;
    }
    
    // Extract selected buses from schedules
    const selectedBuses = busSchedules.map(s => s.selectedBus);
    console.log('selectedBuses:', selectedBuses);
    
    // Flatten all trips from all schedules for charger optimization
    const allTrips = busSchedules.flatMap(s => s.trips);
    console.log('allTrips:', allTrips);
    
    // Now optimize chargers based on SELECTED buses only
    console.log('Calling optimizeChargers...');
    const chargerScenarios = optimizeChargers(selectedBuses, allTrips, depotClimate);
    console.log('chargerScenarios:', chargerScenarios);
    
    // Update currentResults with charger recommendations
    currentResults = {
        busSchedules: busSchedules,
        chargers: chargerScenarios,
        selectedBuses: selectedBuses,
        trips: allTrips
    };
    console.log('currentResults:', currentResults);
    
    // Display final results (Steps 2-5)
    console.log('Calling displayFinalResults...');
    displayFinalResults(currentResults);
}

function displayFinalResults(results) {
    console.log('displayFinalResults called with:', results);
    
    try {
        // Step 2: Fleet Summary
        console.log('Displaying fleet summary...');
        displaySelectedFleetSummary(results);
        
        // Step 3: Selected Buses Detail
        console.log('Displaying selected buses...');
        displaySelectedBuses(results.selectedBuses);
        
        // Step 4: Charger Recommendations
        console.log('Displaying charger recommendations...');
        displayChargerRecommendations(results.chargers);
        
        // Step 5: Charts
        console.log('Displaying charts...');
        displayCharts(results);
        
        // Hide Step 1, Show Steps 2-5
        console.log('Toggling visibility...');
        const busSelectionSection = document.getElementById('busSelectionSection');
        if (busSelectionSection) busSelectionSection.style.display = 'none';
        document.getElementById('fleetSummarySection').style.display = 'block';
        document.getElementById('selectedBusesSection').style.display = 'block';
        document.getElementById('chargerSection').style.display = 'block';
        document.getElementById('costChartSection').style.display = 'block';
        document.getElementById('rangeChartSection').style.display = 'block';
        document.getElementById('timelineChartSection').style.display = 'block';
        
        // Scroll to fleet summary
        console.log('Scrolling to fleet summary...');
        document.getElementById('fleetSummarySection').scrollIntoView({ behavior: 'smooth' });
        console.log('displayFinalResults completed successfully!');
    } catch (error) {
        console.error('Error in displayFinalResults:', error);
        alert('Error displaying results: ' + error.message);
    }
}

function displaySelectedFleetSummary(results) {
    const container = document.getElementById('selectedFleetSummary');
    const totalSchedules = results.busSchedules.length;
    const totalTrips = results.trips.length;
    const totalBuses = results.selectedBuses.length;
    const totalMiles = results.trips.reduce((sum, r) => sum + r.miles, 0);
    const totalCost = results.selectedBuses.reduce((sum, bus) => {
        return sum + (bus.priceRange?.min || 0);
    }, 0);
    
    container.innerHTML = `
        <div class="summary-card">
            <span class="summary-value">${totalSchedules}</span>
            <span class="summary-label">Bus Schedules</span>
        </div>
        <div class="summary-card">
            <span class="summary-value">${totalTrips}</span>
            <span class="summary-label">Total Trips</span>
        </div>
        <div class="summary-card">
            <span class="summary-value">${totalBuses}</span>
            <span class="summary-label">Buses Selected</span>
        </div>
        <div class="summary-card">
            <span class="summary-value">${totalMiles}</span>
            <span class="summary-label">Total Miles/Day</span>
        </div>
        <div class="summary-card">
            <span class="summary-value">$${(totalCost/1000).toFixed(0)}k</span>
            <span class="summary-label">Fleet Cost (min)</span>
        </div>
    `;
}

function displaySelectedBuses(buses) {
    const container = document.getElementById('selectedBusesDetail');
    
    if (!buses || buses.length === 0) {
        container.innerHTML = '<p class="text-muted">No buses selected yet.</p>';
        return;
    }
    
    container.innerHTML = buses.map((bus, idx) => {
        const schedule = busSchedules[idx];
        const totalMiles = schedule.trips.reduce((sum, t) => sum + t.miles, 0);
        const priceMin = bus.priceRange?.min || 0;
        const priceMax = bus.priceRange?.max || 0;
        const priceDisplay = priceMax > 0 
            ? `$${(priceMin/1000).toFixed(0)}k - $${(priceMax/1000).toFixed(0)}k`
            : 'Contact for pricing';
        
        const busTypeDisplay = bus.busType || 'Unknown';
        
        // Calculate effective range for this schedule
        const considerDegradation = document.getElementById('batteryDegradation')?.checked || false;
        const effectiveRange = calculateEffectiveRangeForSchedule(bus, schedule, depotClimate, considerDegradation);
        
        return `
            <div class="bus-card">
                <div class="bus-card-header">
                    <div>
                        <h3>${bus.manufacturer} ${bus.model}</h3>
                        <p class="bus-type">${busTypeDisplay} • ${bus.passengerCapacity} Passengers</p>
                    </div>
                    <div class="bus-price">${priceDisplay}</div>
                </div>
                
                <div class="bus-trip-assignment">
                    <strong>Assigned to:</strong> ${schedule.name} (${schedule.trips.length} trips, ${totalMiles} miles total)
                    <div style="margin-top: 0.5rem;">
                        ${schedule.trips.map((trip, tripIdx) => `
                            <div class="trip-pill-small" style="display: inline-block; margin: 0.25rem; padding: 0.25rem 0.5rem; background: var(--primary-light); border-radius: 4px; font-size: 0.85rem;">
                                Trip ${tripIdx + 1}: ${trip.startLocation || 'Unknown'} → ${trip.endLocation || 'Unknown'} (${trip.miles} mi)
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="bus-specs">
                    <div class="spec">
                        <span class="spec-label">Battery</span>
                        <span class="spec-value">${bus.batteryCapacity} kWh</span>
                    </div>
                    <div class="spec">
                        <span class="spec-label">Rated Range</span>
                        <span class="spec-value">${bus.rangeRated} mi</span>
                    </div>
                    <div class="spec">
                        <span class="spec-label">Effective Range</span>
                        <span class="spec-value">${effectiveRange ? effectiveRange.toFixed(0) : bus.rangeRated} mi</span>
                    </div>
                    <div class="spec">
                        <span class="spec-label">GVWR</span>
                        <span class="spec-value">${bus.gvwr.toLocaleString()} lbs</span>
                    </div>
                </div>
                
                ${bus.notesForBuyers ? `
                    <div class="bus-notes">
                        <strong>Notes:</strong> ${bus.notesForBuyers}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function displayResults(results) {
    // Fleet Summary
    displayFleetSummary(results);
    
    // Compatible Buses
    displayCompatibleBuses(results.buses);
    
    // Charger Recommendations
    displayChargerRecommendations(results.chargers);
    
    // Charts
    displayCharts(results);
}

function displayFleetSummary(results) {
    const container = document.getElementById('fleetSummary');
    const totalRoutes = results.trips.length;
    const totalMiles = results.trips.reduce((sum, r) => sum + r.miles, 0);
    const compatibleBusModels = results.buses.length;
    const minBusesNeeded = 1; // Simplified - could be more complex
    
    container.innerHTML = `
        <div class="summary-card">
            <span class="summary-value">${totalRoutes}</span>
            <span class="summary-label">Total Routes</span>
        </div>
        <div class="summary-card">
            <span class="summary-value">${totalMiles}</span>
            <span class="summary-label">Total Daily Miles</span>
        </div>
        <div class="summary-card">
            <span class="summary-value">${compatibleBusModels}</span>
            <span class="summary-label">Compatible Models</span>
        </div>
        <div class="summary-card">
            <span class="summary-value">${minBusesNeeded}</span>
            <span class="summary-label">Min Buses Needed</span>
        </div>
    `;
}

function displayCompatibleBuses(buses) {
    const container = document.getElementById('compatibleBuses');
    
    if (buses.length === 0) {
        container.innerHTML = `
            <div class="bus-warning">
                <div class="compatibility-title">⚠️ No Compatible Buses Found</div>
                <p>No buses in our database can meet all your trip requirements. Consider:</p>
                <ul>
                    <li>Reducing trip distances</li>
                    <li>Splitting long trips into multiple shorter trips</li>
                    <li>Adding mid-day charging opportunities</li>
                    <li>Reducing passenger capacity requirements</li>
                </ul>
            </div>
        `;
        return;
    }
    
    container.innerHTML = buses.map(bus => {
        const priceMin = bus.priceRange.min ? `$${bus.priceRange.min.toLocaleString()}` : 'N/A';
        const priceMax = bus.priceRange.max ? `$${bus.priceRange.max.toLocaleString()}` : 'N/A';
        
        return `
            <div class="bus-card">
                <div class="bus-card-header">
                    <div>
                        <div class="bus-title">${bus.manufacturer} ${bus.model}</div>
                        <div class="bus-subtitle">${bus.priceRange.note || ''}</div>
                    </div>
                    <span class="bus-type-badge">${bus.busType}</span>
                </div>
                
                <div class="bus-compatibility">
                    <div class="compatibility-title">✓ Compatible with Your Routes</div>
                    <div class="trip-assignment">
                        <strong>Can serve:</strong>
                        ${bus.compatibility.routeAssignments.map(r => 
                            `<span class="trip-tag">${r}</span>`
                        ).join('')}
                    </div>
                    ${bus.compatibility.warnings.length > 0 ? `
                        <div style="margin-top: 10px;">
                            <strong>Notes:</strong>
                            <ul style="margin: 5px 0 0 20px;">
                                ${bus.compatibility.warnings.map(w => `<li>${w}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
                
                <div class="bus-specs">
                    <div class="spec-item">
                        <span class="spec-label">Price Range</span>
                        <span class="spec-value">${priceMin} - ${priceMax}</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">Capacity</span>
                        <span class="spec-value">${bus.passengerCapacity || 'N/A'} passengers</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">Effective Range</span>
                        <span class="spec-value">${bus.effectiveRange || bus.rangeRated || 'N/A'} miles</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">Battery</span>
                        <span class="spec-value">${bus.battery.nameplateKwh || bus.battery.options?.[0]?.nameplateKwh || 'N/A'} kWh</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">Max Charge Rate</span>
                        <span class="spec-value">DC: ${bus.maxVehicleAcceptanceRate.dcfc || 'N/A'} kW</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">Delivery Time</span>
                        <span class="spec-value">${bus.deliveryTime || 'N/A'}</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">V2G Capable</span>
                        <span class="spec-value">${bus.bidirectionalCapable ? 'Yes' : 'No'}</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">Battery Warranty</span>
                        <span class="spec-value">${bus.warranty.battery || 'N/A'}</span>
                    </div>
                </div>
                
                ${bus.oemWebsite ? `
                    <div style="margin-top: 15px;">
                        <a href="${bus.oemWebsite}" target="_blank" class="btn btn-primary btn-sm">
                            Visit Manufacturer Website →
                        </a>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function displayChargerRecommendations(scenarios) {
    const container = document.getElementById('chargerRecommendations');
    
    if (!container) {
        console.error('chargerRecommendations container not found');
        return;
    }
    
    // Update fleet size display - use busSchedules instead of old selectedBuses
    const fleetSize = busSchedules.length;
    const fleetSizeSpan = document.getElementById('fleetSize');
    if (fleetSizeSpan) {
        fleetSizeSpan.textContent = fleetSize;
    }
    
    container.innerHTML = Object.entries(scenarios).map(([key, scenario]) => `
        <div class="charger-scenario ${key === 'cost-optimized' ? 'active' : ''}" data-scenario="${key}">
            <div class="charger-summary">
                <h3>${scenario.name}</h3>
                <p>${scenario.description}</p>
                
                <div class="charger-summary-grid" style="margin-top: 15px;">
                    <div class="summary-card">
                        <span class="summary-value">$${scenario.totalCost.toLocaleString()}</span>
                        <span class="summary-label">Equipment Cost</span>
                    </div>
                    <div class="summary-card">
                        <span class="summary-value">$${scenario.estimatedInstallCost.toLocaleString()}</span>
                        <span class="summary-label">Est. Installation</span>
                    </div>
                    <div class="summary-card">
                        <span class="summary-value">$${(scenario.totalCost + scenario.estimatedInstallCost).toLocaleString()}</span>
                        <span class="summary-label">Total Investment</span>
                    </div>
                </div>
            </div>
            
            <div class="charger-list">
                ${scenario.chargers.map(charger => {
                    const avgCost = (charger.priceRange.min + charger.priceRange.max) / 2;
                    const totalCost = avgCost * charger.quantity;
                    
                    return `
                        <div class="charger-item">
                            <div>
                                <div class="charger-name">${charger.chargingType} - ${charger.kw}${charger.kwMax && charger.kwMax !== charger.kw ? `-${charger.kwMax}` : ''} kW</div>
                                <div class="charger-specs">
                                    ${charger.handleType} | ${charger.networkable ? 'Networkable' : 'Non-networkable'}
                                </div>
                                <div class="charger-specs" style="margin-top: 5px;">
                                    ${charger.reason}
                                </div>
                            </div>
                            <div class="charger-quantity">
                                <div class="charger-quantity-value">${charger.quantity}</div>
                                <div style="font-size: 0.875rem; color: var(--text-secondary);">Units</div>
                            </div>
                            <div class="charger-cost">
                                <div style="font-weight: 600;">$${avgCost.toLocaleString()}</div>
                                <div style="font-size: 0.875rem; color: var(--text-secondary);">per unit</div>
                            </div>
                            <div class="charger-total">
                                <div style="font-weight: 700; font-size: 1.125rem;">$${totalCost.toLocaleString()}</div>
                                <div style="font-size: 0.875rem; color: var(--text-secondary);">subtotal</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');
}

function displayCharts(results) {
    // Use selectedBuses if available, otherwise use all compatible buses
    const busesToChart = results.selectedBuses || results.buses;
    
    // Only display charts if there are buses
    if (busesToChart && busesToChart.length > 0) {
        displayCostChart(results);
        displayRangeChart(results);
    }
    
    // Always display timeline if there are trips
    if (results.trips && results.trips.length > 0) {
        displayTimelineChart(results);
    }
}

function displayCostChart(results) {
    // Use selectedBuses if available, otherwise use top 5 compatible buses
    const buses = results.selectedBuses || results.buses.slice(0, 5);
    
    // Safety check
    if (buses.length === 0) {
        document.getElementById('costChart').innerHTML = '<p style="text-align: center; padding: 40px; color: #5b616b;">No compatible buses to display cost comparison.</p>';
        return;
    }
    
    // Get charger costs for selected scenario
    const scenarioKey = selectedChargerScenario || 'cost-optimized';
    const chargerEquipmentCost = results.chargers[scenarioKey].totalCost;
    const chargerInstallCost = results.chargers[scenarioKey].estimatedInstallCost;
    const totalChargerCost = chargerEquipmentCost + chargerInstallCost;
    
    // Count buses per model
    const busModels = {};
    buses.forEach(bus => {
        const key = `${bus.manufacturer} ${bus.model}`;
        if (!busModels[key]) {
            busModels[key] = {
                bus: bus,
                count: 0,
                unitCost: (bus.priceRange.min + bus.priceRange.max) / 2
            };
        }
        busModels[key].count++;
    });
    
    // Calculate totals
    const totalBusCost = buses.reduce((sum, b) => sum + (b.priceRange.min + b.priceRange.max) / 2, 0);
    const grandTotal = totalBusCost + totalChargerCost;
    
    // Build table HTML
    let tableHTML = `
        <div style="overflow-x: auto;">
            <table class="cost-table" style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                    <tr style="background: var(--primary-color); color: white;">
                        <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Item</th>
                        <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Quantity</th>
                        <th style="padding: 12px; text-align: right; border: 1px solid #ddd;">Unit Cost</th>
                        <th style="padding: 12px; text-align: right; border: 1px solid #ddd;">Total Cost</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    // Add bus rows
    Object.entries(busModels).forEach(([modelName, data]) => {
        const totalModelCost = data.unitCost * data.count;
        tableHTML += `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 12px; font-weight: 600;">${modelName}</td>
                <td style="padding: 12px; text-align: center;">${data.count}</td>
                <td style="padding: 12px; text-align: right;">$${(data.unitCost / 1000).toFixed(0)}k</td>
                <td style="padding: 12px; text-align: right; font-weight: 600;">$${(totalModelCost / 1000).toFixed(0)}k</td>
            </tr>
        `;
    });
    
    // Buses subtotal
    tableHTML += `
        <tr style="background: #f8f9fa; font-weight: 700;">
            <td style="padding: 12px;" colspan="3">Buses Subtotal</td>
            <td style="padding: 12px; text-align: right; color: var(--primary-color);">$${(totalBusCost / 1000).toFixed(0)}k</td>
        </tr>
    `;
    
    // Infrastructure rows
    const chargerScenario = results.chargers[scenarioKey];
    
    if (chargerScenario && chargerScenario.chargers) {
        chargerScenario.chargers.forEach(c => {
            if (!c) return;
            const type = c.chargingType || 'Unknown';
            const power = c.kw || c.kwMax || 'N/A';
            const name = `${type} - ${power} kW`;
            
            const avgEquipCost = (c.priceRange.min + c.priceRange.max) / 2;
            const totalEquipCost = avgEquipCost * c.quantity;
            
            const installCostMap = { '$': 5000, '$$': 15000, '$$$': 35000, '$$$$': 75000 };
            const unitInstallCost = installCostMap[c.infrastructureCost] || 10000;
            const totalInstallCost = unitInstallCost * c.quantity;
            
            // Equipment Row
            tableHTML += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 12px; font-weight: 600;">${name} (Equipment)</td>
                    <td style="padding: 12px; text-align: center;">${c.quantity}</td>
                    <td style="padding: 12px; text-align: right;">$${(avgEquipCost / 1000).toFixed(1)}k</td>
                    <td style="padding: 12px; text-align: right; font-weight: 600;">$${(totalEquipCost / 1000).toFixed(1)}k</td>
                </tr>
            `;
            
            // Installation Row
            tableHTML += `
                <tr style="border-bottom: 1px solid #ddd;">
                    <td style="padding: 12px; font-weight: 600;">${name} (Installation)</td>
                    <td style="padding: 12px; text-align: center;">${c.quantity}</td>
                    <td style="padding: 12px; text-align: right;">$${(unitInstallCost / 1000).toFixed(1)}k</td>
                    <td style="padding: 12px; text-align: right; font-weight: 600;">$${(totalInstallCost / 1000).toFixed(1)}k</td>
                </tr>
            `;
        });
    } else {
        // Fallback if no detailed charger data
        tableHTML += `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 12px; font-weight: 600;">Charger Equipment</td>
                <td style="padding: 12px; text-align: center;">—</td>
                <td style="padding: 12px; text-align: right;">—</td>
                <td style="padding: 12px; text-align: right; font-weight: 600;">$${(chargerEquipmentCost / 1000).toFixed(0)}k</td>
            </tr>
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 12px; font-weight: 600;">Installation</td>
                <td style="padding: 12px; text-align: center;">—</td>
                <td style="padding: 12px; text-align: right;">—</td>
                <td style="padding: 12px; text-align: right; font-weight: 600;">$${(chargerInstallCost / 1000).toFixed(0)}k</td>
            </tr>
        `;
    }

    tableHTML += `
        <tr style="background: #f8f9fa; font-weight: 700;">
            <td style="padding: 12px;" colspan="3">Infrastructure Subtotal</td>
            <td style="padding: 12px; text-align: right; color: var(--primary-color);">$${(totalChargerCost / 1000).toFixed(0)}k</td>
        </tr>
    `;
    
    // Grand total
    tableHTML += `
        <tr style="background: var(--primary-color); color: white; font-size: 1.1rem; font-weight: 700;">
            <td style="padding: 15px;" colspan="3">GRAND TOTAL</td>
            <td style="padding: 15px; text-align: right;">$${(grandTotal / 1000).toFixed(0)}k</td>
        </tr>
    `;
    
    tableHTML += `
                </tbody>
            </table>
        </div>
    `;
    
    document.getElementById('costChart').innerHTML = tableHTML;
}

function displayRangeChart(results) {
    // Use busSchedules to show each route with its selected bus
    const schedules = results.busSchedules || busSchedules;
    
    // Safety check
    if (!schedules || schedules.length === 0) {
        document.getElementById('rangeChart').innerHTML = '<p style="text-align: center; padding: 40px; color: #5b616b;">No routes to display range comparison.</p>';
        return;
    }
    
    // Build data for each route
    const categories = [];
    const routeMileageData = [];
    const effectiveRangeData = [];
    const rangeLossData = [];
    
    const considerDegradation = document.getElementById('batteryDegradation')?.checked;

    schedules.forEach(schedule => {
        if (schedule.selectedBus) {
            const routeName = schedule.name || `Route ${schedule.id}`;
            const busName = `${schedule.selectedBus.manufacturer} ${schedule.selectedBus.model}`;
            const totalMiles = schedule.trips.reduce((sum, trip) => sum + trip.miles, 0);
            
            // Calculate effective range dynamically
            const effectiveRange = calculateEffectiveRangeForSchedule(schedule.selectedBus, schedule, depotClimate, considerDegradation);
            const ratedRange = schedule.selectedBus.rangeRated || 0;
            const loss = Math.max(0, ratedRange - effectiveRange);
            
            categories.push(`${routeName}<br/><span style="font-size: 0.8em; color: #666;">${busName}</span>`);
            routeMileageData.push(totalMiles);
            effectiveRangeData.push(effectiveRange);
            rangeLossData.push(loss);
        }
    });
    
    if (categories.length === 0) {
        document.getElementById('rangeChart').innerHTML = '<p style="text-align: center; padding: 40px; color: #5b616b;">No buses selected to display range comparison.</p>';
        return;
    }
    
    Highcharts.chart('rangeChart', {
        chart: {
            type: 'bar',
            height: Math.max(300, categories.length * 120)
        },
        title: {
            text: 'Route Range Requirements vs. Bus Capabilities'
        },
        xAxis: {
            categories: categories,
            labels: {
                useHTML: true
            }
        },
        yAxis: {
            min: 0,
            title: {
                text: 'Miles'
            },
            stackLabels: {
                enabled: true,
                style: {
                    fontWeight: 'bold',
                    color: 'gray'
                },
                formatter: function() {
                    if (this.stack === 'rated') {
                        return 'Rated: ' + this.total.toFixed(0) + ' mi';
                    }
                    return '';
                }
            }
        },
        tooltip: {
            shared: true,
            formatter: function() {
                // Ensure x is treated as a string (it might be an index number in some cases)
                const xValue = typeof this.x === 'string' ? this.x : (this.points && this.points[0] ? this.points[0].key : String(this.x));
                const routeName = String(xValue).split('<br/>')[0];
                
                let tooltip = `<b>${routeName}</b><br/>`;
                
                // Find points
                const mileagePoint = this.points.find(p => p.series.name === 'Route Mileage');
                const effectivePoint = this.points.find(p => p.series.name === 'Effective Range');
                const lossPoint = this.points.find(p => p.series.name.includes('Decrease'));
                
                if (effectivePoint) {
                    tooltip += `<span style="color:${effectivePoint.color}">\u25CF</span> Effective Range: <b>${effectivePoint.y.toFixed(1)} mi</b><br/>`;
                }
                if (lossPoint) {
                    tooltip += `<span style="color:${lossPoint.color}">\u25CF</span> Range Decrease: <b>${lossPoint.y.toFixed(1)} mi</b><br/>`;
                }
                if (mileagePoint) {
                    tooltip += `<span style="color:${mileagePoint.color}">\u25CF</span> Route Mileage: <b>${mileagePoint.y.toFixed(1)} mi</b><br/>`;
                }
                
                if (mileagePoint && effectivePoint) {
                    const margin = effectivePoint.y - mileagePoint.y;
                    const percentage = ((margin / effectivePoint.y) * 100).toFixed(0);
                    const color = margin >= 0 ? 'green' : 'red';
                    tooltip += `<br/>Margin: <b style="color:${color}">${margin.toFixed(1)} mi (${percentage}%)</b>`;
                }
                return tooltip;
            }
        },
        plotOptions: {
            bar: {
                grouping: true,
                borderWidth: 0,
                dataLabels: {
                    enabled: true,
                    formatter: function() {
                        if (this.series.name === 'Route Mileage') return this.y.toFixed(0) + ' mi';
                        if (this.series.name === 'Effective Range') return this.y.toFixed(0) + ' mi';
                        return '';
                    }
                }
            },
            series: {
                stacking: 'normal'
            }
        },
        series: [{
            name: 'Range Decrease (Weather/Terrain)',
            data: rangeLossData,
            stack: 'rated',
            color: '#88c0d0', // Light Blue
            pointWidth: 25,
            legendIndex: 1
        }, {
            name: 'Effective Range',
            data: effectiveRangeData,
            stack: 'rated',
            color: '#2e8540', // Green
            pointWidth: 25,
            legendIndex: 0
        }, {
            name: 'Route Mileage',
            data: routeMileageData,
            stack: 'route',
            color: '#4a4a4a', // Dark Gray
            pointWidth: 25,
            legendIndex: 2
        }],
        legend: {
            enabled: true,
            align: 'center',
            verticalAlign: 'bottom'
        }
    });
}

function displayTimelineChart(results) {
    const schedules = results.busSchedules || busSchedules;
    
    // Get selected charger scenario
    const scenarioKey = selectedChargerScenario || 'cost-optimized';
    const chargerScenario = results.chargers ? results.chargers[scenarioKey] : null;
    
    if (!chargerScenario) {
        console.warn('No charger scenario available for timeline');
        return;
    }
    
    if (!schedules || schedules.length === 0) {
        console.warn('No schedules available for timeline');
        document.getElementById('timelineChart').innerHTML = '<p style="text-align: center; padding: 40px; color: #5b616b;">No bus schedules to display.</p>';
        return;
    }
    
    // Build timeline data for each bus
    const categories = [];
    const busTimelines = [];
    let validBusIndex = 0;
    
    // Create timeline for each bus
    schedules.forEach((schedule) => {
        const bus = schedule.selectedBus;
        if (!bus) {
            console.warn('Schedule missing selectedBus:', schedule);
            return;
        }
        
        const manufacturer = bus.manufacturer || 'Unknown';
        const model = bus.model || 'Bus';
        const busName = `${manufacturer} ${model}`;
        const routeName = schedule.name || `Route ${schedule.id || 'Unknown'}`;
        
        // Emphasize Bus Name
        categories.push(`<b>${busName}</b><br/><span style="font-size: 0.85em; color: #666;">${routeName}</span>`);
        
        const timeline = {
            busIndex: validBusIndex,
            routeName: routeName,
            busName: busName,
            bus: bus,
            trips: schedule.trips || [],
            periods: []
        };
        
        // Add all route running periods
        if (schedule.trips && schedule.trips.length > 0) {
            schedule.trips.forEach(trip => {
                const routeStart = timeToMinutes(trip.startTime || '07:00');
                const routeEnd = timeToMinutes(trip.endTime || '16:00');
                
                timeline.periods.push({
                    type: 'route',
                    start: routeStart,
                    end: routeEnd,
                    trip: trip
                });
            });
        }
        
        // Sort periods by start time
        timeline.periods.sort((a, b) => a.start - b.start);
        
        busTimelines.push(timeline);
        validBusIndex++;
    });
    
    // Calculate charging periods with charger queue management
    const chargingQueue = calculateChargingSchedule(busTimelines, chargerScenario);
    
    // Apply charging periods to timelines
    chargingQueue.forEach(charge => {
        busTimelines[charge.busIndex].periods.push({
            type: 'charging',
            start: charge.start,
            end: charge.end,
            chargerType: charge.chargerType
        });
    });
    
    // Prepare series data
    const mainSeriesData = [];

    // Sort periods again and fill in idle time
    busTimelines.forEach((timeline, busIndex) => {
        timeline.periods.sort((a, b) => a.start - b.start);
        
        // Fill gaps with idle periods
        const idlePeriods = [];
        let currentTime = 0; // Start at midnight
        
        timeline.periods.forEach(period => {
            if (currentTime < period.start) {
                idlePeriods.push({
                    type: 'idle',
                    start: currentTime,
                    end: period.start
                });
            }
            currentTime = period.end;
        });
        
        // Add final idle period to end of day
        if (currentTime < 1440) {
            idlePeriods.push({
                type: 'idle',
                start: currentTime,
                end: 1440
            });
        }
        
        timeline.periods.push(...idlePeriods);
        timeline.periods.sort((a, b) => a.start - b.start);
        
        // Add to main series
        timeline.periods.forEach(period => {
            let color = '#e0e0e0'; // Idle
            if (period.type === 'route') color = '#0071bc';
            if (period.type === 'charging') color = '#00b475';
            
            mainSeriesData.push({
                x: period.start,
                x2: period.end,
                y: busIndex,
                color: color,
                // custom properties for tooltip
                periodType: period.type,
                trip: period.trip,
                chargerType: period.chargerType,
                busName: timeline.busName,
                routeName: timeline.routeName
            });
        });
    });
    
    Highcharts.chart('timelineChart', {
        chart: {
            type: 'xrange',
            height: Math.max(300, busTimelines.length * 80)
        },
        title: {
            text: `24-Hour Fleet Timeline (${scenarioKey.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Scenario)`
        },
        xAxis: {
            type: 'linear',
            min: 0,        // Midnight
            max: 1440,     // 11:59 PM (24 hours)
            tickInterval: 120, // Every 2 hours
            labels: {
                formatter: function() {
                    const hours = Math.floor(this.value / 60);
                    const minutes = this.value % 60;
                    if (minutes === 0) {
                        if (hours === 0) return '12 AM';
                        if (hours === 12) return '12 PM';
                        return hours > 12 ? `${hours - 12} PM` : `${hours} AM`;
                    }
                    return '';
                }
            }
        },
        yAxis: {
            title: {
                text: ''
            },
            categories: categories,
            reversed: true,
            labels: {
                useHTML: true
            }
        },
        legend: {
            enabled: true,
            align: 'center',
            verticalAlign: 'bottom',
            itemStyle: {
                cursor: 'default'
            },
            itemHoverStyle: {
                cursor: 'default'
            }
        },
        tooltip: {
            formatter: function() {
                const startTime = minutesToTimeString(this.point.x);
                const endTime = minutesToTimeString(this.point.x2);
                const duration = this.point.x2 - this.point.x;
                const durationStr = `${Math.floor(duration / 60)}h ${duration % 60}m`;
                
                let typeLabel = 'Idle/Available';
                if (this.point.periodType === 'route') typeLabel = 'Route Running';
                if (this.point.periodType === 'charging') typeLabel = 'Charging';
                
                let tooltip = `<b>${this.point.busName}</b><br/>` +
                       `<i>${this.point.routeName}</i><br/>` +
                       `<span style="color:${this.point.color}">\u25CF</span> ${typeLabel}<br/>` +
                       `${startTime} - ${endTime} (${durationStr})`;
                
                if (this.point.trip) {
                    tooltip += `<br/>Distance: ${this.point.trip.miles} mi`;
                }
                if (this.point.chargerType) {
                    tooltip += `<br/>Charger: ${this.point.chargerType}`;
                }
                
                return tooltip;
            }
        },
        series: [
            {
                name: 'Timeline',
                pointWidth: 20,
                data: mainSeriesData,
                dataLabels: { enabled: false },
                showInLegend: false
            },
            // Dummy series for Legend
            { 
                name: 'Route Running', 
                color: '#0071bc', 
                type: 'scatter',
                marker: { symbol: 'square', radius: 6 },
                data: [], 
                events: { legendItemClick: function() { return false; } } 
            },
            { 
                name: 'Charging', 
                color: '#00b475', 
                type: 'scatter',
                marker: { symbol: 'square', radius: 6 },
                data: [], 
                events: { legendItemClick: function() { return false; } } 
            },
            { 
                name: 'Idle/Available', 
                color: '#e0e0e0', 
                type: 'scatter',
                marker: { symbol: 'square', radius: 6 },
                data: [], 
                events: { legendItemClick: function() { return false; } } 
            }
        ],
        plotOptions: {
            xrange: {
                borderRadius: 3,
                borderWidth: 0,
                grouping: false,
                dataLabels: {
                    enabled: false
                }
            }
        }
    });
}

function calculateChargingSchedule(busTimelines, chargerScenario) {
    const chargingSchedule = [];
    
    if (!chargerScenario || !chargerScenario.chargers || chargerScenario.chargers.length === 0) {
        console.warn('No chargers in scenario');
        return chargingSchedule;
    }
    
    // Get available chargers and their capabilities
    const availableChargers = [];
    chargerScenario.chargers.forEach(charger => {
        if (!charger) return;
        for (let i = 0; i < (charger.quantity || 1); i++) {
            availableChargers.push({
                power: charger.kw || charger.kwMax || 50,
                type: charger.chargingType || 'Unknown',
                busyUntil: 0 // Minutes from midnight
            });
        }
    });
    
    if (availableChargers.length === 0) {
        console.warn('No available chargers configured');
        return chargingSchedule;
    }
    
    // Calculate charging needs for each bus after their routes
    const chargingNeeds = [];
    
    busTimelines.forEach((timeline, busIndex) => {
        // Calculate total energy used across all trips
        let totalMilesForDay = 0;
        let lastTripEnd = 0;
        
        timeline.periods.forEach(period => {
            if (period.type === 'route' && period.trip) {
                totalMilesForDay += period.trip.miles || 0;
                lastTripEnd = Math.max(lastTripEnd, period.end);
            }
        });
        
        const bus = timeline.bus;
        
        // Check if we have the necessary data
        if (!bus.batteryCapacity || !bus.rangeRated || bus.rangeRated === 0) {
            console.warn('Bus missing battery or range data:', bus);
            return;
        }
        
        const energyPerMile = bus.batteryCapacity / bus.rangeRated;
        const energyNeeded = totalMilesForDay * energyPerMile;
        
        // Store acceptance rates
        const acceptanceRates = {
            level2: 19.2, // Default
            dcfc: 50      // Default
        };
        
        if (bus.maxVehicleAcceptanceRate) {
            if (bus.maxVehicleAcceptanceRate.level2) acceptanceRates.level2 = bus.maxVehicleAcceptanceRate.level2;
            if (bus.maxVehicleAcceptanceRate.dcfc) acceptanceRates.dcfc = bus.maxVehicleAcceptanceRate.dcfc;
        }
        
        chargingNeeds.push({
            busIndex: busIndex,
            busName: timeline.busName,
            energyNeeded: energyNeeded,
            acceptanceRates: acceptanceRates,
            earliestStart: lastTripEnd + 15 // 15 min buffer after last trip
        });
    });
    
    // Sort charging needs by earliest start time (first come, first served)
    chargingNeeds.sort((a, b) => a.earliestStart - b.earliestStart);
    
    // Assign buses to chargers
    chargingNeeds.forEach(need => {
        // Find first available charger
        let bestCharger = availableChargers[0];
        for (let charger of availableChargers) {
            if (charger.busyUntil < bestCharger.busyUntil) {
                bestCharger = charger;
            }
        }
        
        // Determine actual charging power based on charger type and bus capability
        let maxBusAcceptance = need.acceptanceRates.dcfc; // Default to DCFC rate
        
        if (bestCharger.type.includes('Level 2') || bestCharger.type.includes('AC')) {
            maxBusAcceptance = need.acceptanceRates.level2;
        }
        
        const chargingPower = Math.min(maxBusAcceptance, bestCharger.power);
        
        // Calculate charging time
        const chargingTimeHours = need.energyNeeded / chargingPower;
        const chargingTimeMinutes = Math.ceil(chargingTimeHours * 60);
        
        // Schedule charging
        const chargingStart = Math.max(need.earliestStart, bestCharger.busyUntil);
        const chargingEnd = Math.min(chargingStart + chargingTimeMinutes, 1440); // Don't go past midnight
        
        chargingSchedule.push({
            busIndex: need.busIndex,
            start: chargingStart,
            end: chargingEnd,
            chargerType: bestCharger.type,
            power: chargingPower
        });
        
        // Mark charger as busy
        bestCharger.busyUntil = chargingEnd;
    });
    
    return chargingSchedule;
}

function minutesToTimeString(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);
    return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

// ==========================
// Utility Functions
// ==========================
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ==========================
// Page-Specific Renderers
// ==========================
function renderBusSelectionPage() {
    const container = document.getElementById('busSelectionContainer');
    const considerDegradation = document.getElementById('batteryDegradation')?.checked;
    
    // Find the most versatile bus (compatible with most routes)
    const busCompatibilityCount = {};
    const allCompatibleBuses = [];
    
    busSchedules.forEach(schedule => {
        const totalMiles = schedule.trips.reduce((sum, t) => sum + t.miles, 0);
        const maxPassengers = Math.max(...schedule.trips.map(t => t.passengers));
        
        const compatibleBuses = busesData.filter(bus => {
            if (bus.passengerCapacity && bus.passengerCapacity < maxPassengers) return false;
            const effectiveRange = calculateEffectiveRangeForSchedule(bus, schedule, depotClimate, considerDegradation);
            if (!effectiveRange || effectiveRange < totalMiles) return false;
            return true;
        });
        
        compatibleBuses.forEach(bus => {
            busCompatibilityCount[bus.id] = (busCompatibilityCount[bus.id] || 0) + 1;
            if (!allCompatibleBuses.find(b => b.id === bus.id)) {
                allCompatibleBuses.push(bus);
            }
        });
    });
    
    // Find buses that work for ALL routes
    const totalRoutes = busSchedules.length;
    const universalBuses = allCompatibleBuses.filter(bus => 
        busCompatibilityCount[bus.id] === totalRoutes
    );
    
    // Check if user has made a strategy choice
    const strategyChosen = window.busSelectionStrategy || null; // 'standardize' or 'customize'
    const anyBusSelected = busSchedules.some(s => s.selectedBus);
    
    // Build initial choice section or recommendation section
    let recommendationHTML = '';
    if (universalBuses.length > 0 && !strategyChosen && !anyBusSelected) {
        // Show initial choice buttons
        recommendationHTML = `
            <div class="bus-selection-strategy" style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); border: 2px solid var(--primary-color); border-radius: var(--border-radius); padding: 30px; margin-bottom: 30px; text-align: center;">
                <div style="font-size: 3rem; margin-bottom: 15px;">🚌</div>
                <h2 style="margin: 0 0 10px 0; color: var(--primary-color);">Choose Your Bus Selection Strategy</h2>
                <p style="margin: 0 0 25px 0; color: var(--text-secondary); font-size: 1.1rem; max-width: 600px; margin-left: auto; margin-right: auto;">
                    We found <strong>${universalBuses.length} bus${universalBuses.length > 1 ? 'es' : ''}</strong> that work for all ${totalRoutes} of your routes. 
                    How would you like to proceed?
                </p>
                <div style="display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; margin-bottom: 15px;">
                    <button class="btn btn-primary btn-large" onclick="chooseBusSelectionStrategy('standardize')" style="min-width: 250px; padding: 20px; font-size: 1.1rem;">
                        <div style="font-size: 2rem; margin-bottom: 8px;">🎯</div>
                        <div style="font-weight: 600; margin-bottom: 5px;">Standardize Fleet</div>
                        <div style="font-size: 0.9rem; opacity: 0.9;">Use one bus type for all routes</div>
                    </button>
                    <button class="btn btn-secondary btn-large" onclick="chooseBusSelectionStrategy('customize')" style="min-width: 250px; padding: 20px; font-size: 1.1rem;">
                        <div style="font-size: 2rem; margin-bottom: 8px;">🔧</div>
                        <div style="font-weight: 600; margin-bottom: 5px;">Customize Each Route</div>
                        <div style="font-size: 0.9rem; opacity: 0.9;">Select different buses per route</div>
                    </button>
                </div>
                <div style="font-size: 0.875rem; color: var(--text-muted); margin-top: 15px;">
                    💡 Fleet standardization reduces costs and simplifies maintenance
                </div>
            </div>
        `;
    } else if (universalBuses.length > 0 && strategyChosen === 'standardize') {
        // Show fleet standardization section
        const allRoutesHaveStandardBus = busSchedules.every(s => s.selectedBus && universalBuses.some(b => b.id === s.selectedBus.id));
        
        recommendationHTML = `
            <div class="bus-recommendation-banner" style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); border: 2px solid var(--primary-color); border-radius: var(--border-radius); padding: 20px; margin-bottom: 30px;">
                <div style="display: flex; align-items: start; gap: 15px; margin-bottom: 15px;">
                    <div style="flex-shrink: 0; font-size: 2.5rem;">🚌</div>
                    <div style="flex: 1;">
                        <h3 style="margin: 0 0 5px 0; color: var(--primary-color); display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                            <span>Fleet Standardization Options</span>
                            ${allRoutesHaveStandardBus ? '<span style="background: var(--success-color); color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600;">✓ APPLIED</span>' : ''}
                        </h3>
                        <p style="margin: 0 0 10px 0; color: var(--text-secondary); font-size: 1rem;">
                            ${allRoutesHaveStandardBus 
                                ? `Your standard bus has been applied to all routes. Review below or change individual routes as needed.`
                                : `Select one of these ${universalBuses.length} bus${universalBuses.length > 1 ? 'es' : ''} to standardize your fleet.`
                            }
                        </p>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            ${!allRoutesHaveStandardBus ? '<button class="btn btn-secondary btn-sm" onclick="resetBusSelectionStrategy()">← Back to Strategy Choice</button>' : ''}
                            ${allRoutesHaveStandardBus ? '<button class="btn btn-secondary btn-sm" onclick="showFleetStandardization()">Change Standard Bus</button>' : ''}
                        </div>
                    </div>
                </div>
                
                <div id="fleetStandardizationContent" style="display: ${allRoutesHaveStandardBus ? 'none' : 'block'};">
                    <div class="bus-filter-section" style="margin-bottom: 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                            <div class="bus-filters" data-schedule-index="fleet" style="flex: 1;">
                                <div class="filter-group">
                                    <label class="filter-label">Bus Type:</label>
                                    <div class="custom-multiselect" data-filter="type" data-schedule="fleet">
                                        <div class="multiselect-trigger" onclick="toggleMultiselect(this)">
                                            <span class="multiselect-label">Select types...</span>
                                            <span class="multiselect-arrow">▼</span>
                                        </div>
                                        <div class="multiselect-dropdown">
                                            <label><input type="checkbox" value="Type A" onchange="updateMultiselectFilter('fleet', 'type')"> Type A</label>
                                            <label><input type="checkbox" value="Type C" onchange="updateMultiselectFilter('fleet', 'type')"> Type C</label>
                                            <label><input type="checkbox" value="Type D" onchange="updateMultiselectFilter('fleet', 'type')"> Type D</label>
                                        </div>
                                    </div>
                                </div>
                                <div class="filter-group">
                                    <label class="filter-label">Manufacturer:</label>
                                    <div class="custom-multiselect" data-filter="manufacturer" data-schedule="fleet">
                                        <div class="multiselect-trigger" onclick="toggleMultiselect(this)">
                                            <span class="multiselect-label">Select manufacturers...</span>
                                            <span class="multiselect-arrow">▼</span>
                                        </div>
                                        <div class="multiselect-dropdown">
                                            ${[...new Set(universalBuses.map(b => b.manufacturer))].sort().map(m => 
                                                `<label><input type="checkbox" value="${m}" onchange="updateMultiselectFilter('fleet', 'manufacturer')"> ${m}</label>`
                                            ).join('')}
                                        </div>
                                    </div>
                                </div>
                                <div class="filter-group">
                                    <label class="filter-label">Charging:</label>
                                    <div class="custom-multiselect" data-filter="charging" data-schedule="fleet">
                                        <div class="multiselect-trigger" onclick="toggleMultiselect(this)">
                                            <span class="multiselect-label">Select charging...</span>
                                            <span class="multiselect-arrow">▼</span>
                                        </div>
                                        <div class="multiselect-dropdown">
                                            <label><input type="checkbox" value="dcfc" onchange="updateMultiselectFilter('fleet', 'charging')"> Has DC Fast Charging</label>
                                            <label><input type="checkbox" value="ac" onchange="updateMultiselectFilter('fleet', 'charging')"> Has AC Level 2</label>
                                        </div>
                                    </div>
                                </div>
                                <div style="margin-top:0.5rem;"><button class="btn btn-sm btn-secondary" onclick="clearFleetFilters()">Clear All Filters</button></div>
                            </div>
                            <div class="sort-group" style="margin-left: 20px;">
                                <label class="filter-label">Sort By:</label>
                                <div class="custom-multiselect custom-sort-select" style="min-width: 220px;">
                                    <div class="multiselect-trigger" onclick="toggleSortDropdown(this)">
                                        <span class="multiselect-label" id="currentSortLabel">Price (Low to High)</span>
                                        <span class="multiselect-arrow">▼</span>
                                    </div>
                                    <div class="multiselect-dropdown">
                                        <div class="sort-option selected" data-value="price_asc" onclick="selectSortOption('price_asc', 'Price (Low to High)')">Price (Low to High)</div>
                                        <div class="sort-option" data-value="battery_asc" onclick="selectSortOption('battery_asc', 'Battery Size (Low to High)')">Battery Size (Low to High)</div>
                                        <div class="sort-option" data-value="charging_asc" onclick="selectSortOption('charging_asc', 'Charging Speed (Low to High)')">Charging Speed (Low to High)</div>
                                        <div class="sort-option" data-value="range_asc" onclick="selectSortOption('range_asc', 'Rated Range (Low to High)')">Rated Range (Low to High)</div>
                                        <div class="sort-option" data-value="passengers_asc" onclick="selectSortOption('passengers_asc', 'Passengers (Low to High)')">Passengers (Low to High)</div>
                                    </div>
                                </div>
                                <input type="hidden" id="fleetSort" value="price_asc">
                                <style>
                                    .sort-option {
                                        padding: 0.6rem 0.75rem;
                                        cursor: pointer;
                                        transition: background 0.15s;
                                        border-bottom: 1px solid var(--border-color);
                                        font-size: 0.9rem;
                                    }
                                    .sort-option:last-child {
                                        border-bottom: none;
                                    }
                                    .sort-option:hover {
                                        background: #f0f7fc;
                                    }
                                    .sort-option.selected {
                                        background: #e3f2fd;
                                        font-weight: 600;
                                        color: var(--primary-color);
                                    }
                                </style>
                            </div>
                        </div>
                    </div>
                    
                    <div class="bus-cards-grid" id="fleet-buses-grid" data-all-buses='${JSON.stringify(universalBuses).replace(/'/g, "&#39;")}'>
                        ${sortBuses(universalBuses, 'price_asc').map(bus => {
                            const isUsedByAll = busSchedules.every(s => s.selectedBus && s.selectedBus.id === bus.id);
                            const priceMin = bus.priceRange?.min || 0;
                            const priceMax = bus.priceRange?.max || 0;
                            const priceDisplay = priceMax > 0 
                                ? `$${(priceMin/1000).toFixed(0)}k - $${(priceMax/1000).toFixed(0)}k`
                                : 'Contact for pricing';
                            const dcfcSpeed = bus.maxVehicleAcceptanceRate?.dcfc || 'N/A';
                            const level2Speed = bus.maxVehicleAcceptanceRate?.level2 || 'N/A';
                            const batteryWarranty = bus.warranty?.battery || 'Contact manufacturer';
                            
                            // Calculate range utilization for the longest route
                            const maxRouteMiles = Math.max(...busSchedules.map(s => s.trips.reduce((sum, t) => sum + t.miles, 0)));
                            // Find the schedule with max miles to calculate effective range accurately
                            const maxSchedule = busSchedules.find(s => s.trips.reduce((sum, t) => sum + t.miles, 0) === maxRouteMiles);
                            const effectiveRange = calculateEffectiveRangeForSchedule(bus, maxSchedule, depotClimate, considerDegradation);
                            
                            const rangeMargin = effectiveRange - maxRouteMiles;
                            const rangePercent = ((maxRouteMiles / effectiveRange) * 100).toFixed(0);
                            
                            return `
                                <div class="bus-card ${isUsedByAll ? 'selected' : ''}" onclick="applyBusToAll('${bus.id}')" style="cursor: pointer;">
                                    ${isUsedByAll ? '<div class="selected-checkmark">✓ Applied to All</div>' : '<div class="select-prompt">Click to apply to all routes</div>'}
                                    <div class="bus-card-header">
                                        <div>
                                            <div class="bus-title">${bus.manufacturer} ${bus.model}</div>
                                            <div class="bus-subtitle">${bus.busType} • ${bus.passengerCapacity} seats</div>
                                        </div>
                                        <div class="bus-type-badge">${bus.busType}</div>
                                    </div>
                                    <div class="bus-specs">
                                        <div class="spec-item">
                                            <span class="spec-label">Battery Capacity</span>
                                            <span class="spec-value">${bus.batteryCapacity} kWh</span>
                                        </div>
                                        <div class="spec-item">
                                            <span class="spec-label">Rated Range</span>
                                            <span class="spec-value">${bus.rangeRated} mi</span>
                                        </div>
                                        <div class="spec-item">
                                            <span class="spec-label">Effective Range</span>
                                            <span class="spec-value">${effectiveRange.toFixed(0)} mi</span>
                                        </div>
                                        <div class="spec-item">
                                            <span class="spec-label">Price Range</span>
                                            <span class="spec-value">${priceDisplay}</span>
                                        </div>
                                        <div class="spec-item">
                                            <span class="spec-label">DC Fast Charging</span>
                                            <span class="spec-value">${dcfcSpeed} kW</span>
                                        </div>
                                        <div class="spec-item">
                                            <span class="spec-label">AC Level 2</span>
                                            <span class="spec-value">${level2Speed} kW</span>
                                        </div>
                                        <div class="spec-item" style="grid-column: span 2;">
                                            <span class="spec-label">Battery Warranty</span>
                                            <span class="spec-value">${batteryWarranty}</span>
                                        </div>
                                    </div>
                                    
                                    <div class="range-indicator" style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;">
                                        <div class="range-indicator-label">
                                            <span>Range Utilization:</span>
                                            <span>${rangePercent}% (${maxRouteMiles} mi / ${effectiveRange.toFixed(0)} mi)</span>
                                        </div>
                                        <div class="range-bar">
                                            <div class="range-fill ${rangePercent > 90 ? 'danger' : rangePercent > 80 ? 'warning' : ''}" 
                                                 style="width: ${Math.min(rangePercent, 100)}%">
                                                ${rangePercent}%
                                            </div>
                                        </div>
                                        <div style="margin-top: 8px; font-size: 0.875rem; ${rangeMargin < 20 ? 'color: var(--danger-color); font-weight: 600;' : 'color: var(--success-color);'}">
                                            ${rangeMargin >= 0 
                                                ? `✓ ${rangeMargin.toFixed(0)} mi safety margin` 
                                                : `⚠ ${Math.abs(rangeMargin).toFixed(0)} mi SHORT - Choose larger bus`}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }
    
    // Build progress indicator if buses are being selected
    let progressHTML = '';
    if (anyBusSelected) {
        const selectedCount = busSchedules.filter(s => s.selectedBus).length;
        progressHTML = `
            <div style="background: var(--bg-light); border-radius: var(--border-radius); padding: 15px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 15px;">
                <div>
                    <strong style="color: var(--primary-color);">Selection Progress:</strong>
                    <span style="margin-left: 10px;">${selectedCount} of ${totalRoutes} routes have buses selected</span>
                </div>
                <div style="display: flex; gap: 10px;">
                    ${strategyChosen === 'standardize' ? '<button class="btn btn-sm btn-secondary" onclick="resetBusSelectionStrategy()">Reset & Change Strategy</button>' : ''}
                </div>
            </div>
        `;
    }
    
    // Only show individual routes if:
    // - Strategy is 'customize', OR
    // - No universal buses, OR  
    // - Strategy is 'standardize' AND at least one bus is selected
    const showIndividualRoutes = strategyChosen === 'customize' || universalBuses.length === 0 || (strategyChosen === 'standardize' && anyBusSelected);
    
    container.innerHTML = recommendationHTML + progressHTML + (showIndividualRoutes ? busSchedules.map((schedule, scheduleIdx) => {
        const totalMiles = schedule.trips.reduce((sum, t) => sum + t.miles, 0);
        const maxPassengers = Math.max(...schedule.trips.map(t => t.passengers));
        
        // Get compatible buses for this schedule
        const compatibleBuses = busesData.filter(bus => {
            if (bus.passengerCapacity && bus.passengerCapacity < maxPassengers) return false;
            const effectiveRange = calculateEffectiveRangeForSchedule(bus, schedule, depotClimate, considerDegradation);
            if (!effectiveRange || effectiveRange < totalMiles) return false;
            return true;
        });
        
        const isSelected = schedule.selectedBus !== null && schedule.selectedBus !== undefined;
        
        // Check if using a universal bus (works for all routes)
        const isUsingUniversalBus = schedule.selectedBus && universalBuses.some(b => b.id === schedule.selectedBus.id);
        
        return `
            <div class="bus-schedule-selection-section">
                <h3 style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <span>${schedule.name}</span>
                </h3>
                <div class="schedule-summary">
                    <div class="summary-stat">
                        <span class="stat-label">Total Distance</span>
                        <span class="stat-value">${totalMiles} mi</span>
                    </div>
                    <div class="summary-stat">
                        <span class="stat-label">Max Passengers</span>
                        <span class="stat-value">${maxPassengers} seats</span>
                    </div>
                    <div class="summary-stat">
                        <span class="stat-label">Trips</span>
                        <span class="stat-value">${schedule.trips.length}</span>
                    </div>
                </div>
                
                ${isSelected ? `
                    <div class="selected-bus-summary">
                        <div class="selected-bus-info">
                            <div class="selected-bus-label">✓ Selected Bus:</div>
                            <div class="selected-bus-name-main">${schedule.selectedBus.manufacturer} ${schedule.selectedBus.model}</div>
                            <div class="selected-bus-details">
                                ${schedule.selectedBus.busType} • ${schedule.selectedBus.passengerCapacity} seats • ${schedule.selectedBus.batteryCapacity} kWh • ${schedule.selectedBus.rangeRated} mi rated range
                            </div>
                        </div>
                        <button class="btn btn-sm btn-secondary" onclick="toggleBusSelectionForSchedule(${scheduleIdx})">
                            Change Selection
                        </button>
                    </div>
                ` : `
                    <button class="btn btn-primary" onclick="expandBusSelection(${scheduleIdx})" id="expand-bus-btn-${scheduleIdx}">
                        Select Bus for This Route
                    </button>
                `}
                
                <div class="bus-selection-expandable" id="bus-selection-expandable-${scheduleIdx}" style="display: none;">
                    <div class="bus-filter-section">
                        <div class="bus-filters" data-schedule-index="${scheduleIdx}">
                            <div class="filter-group">
                                <label class="filter-label">Bus Type:</label>
                                <div class="custom-multiselect" data-filter="type" data-schedule="${scheduleIdx}">
                                    <div class="multiselect-trigger" onclick="toggleMultiselect(this)">
                                        <span class="multiselect-label">Select types...</span>
                                        <span class="multiselect-arrow">▼</span>
                                    </div>
                                    <div class="multiselect-dropdown">
                                        <label><input type="checkbox" value="Type A" onchange="updateMultiselectFilter(${scheduleIdx}, 'type')"> Type A</label>
                                        <label><input type="checkbox" value="Type C" onchange="updateMultiselectFilter(${scheduleIdx}, 'type')"> Type C</label>
                                        <label><input type="checkbox" value="Type D" onchange="updateMultiselectFilter(${scheduleIdx}, 'type')"> Type D</label>
                                    </div>
                                </div>
                            </div>
                            <div class="filter-group">
                                <label class="filter-label">Manufacturer:</label>
                                <div class="custom-multiselect" data-filter="manufacturer" data-schedule="${scheduleIdx}">
                                    <div class="multiselect-trigger" onclick="toggleMultiselect(this)">
                                        <span class="multiselect-label">Select manufacturers...</span>
                                        <span class="multiselect-arrow">▼</span>
                                    </div>
                                    <div class="multiselect-dropdown">
                                        ${[...new Set(compatibleBuses.map(b => b.manufacturer))].sort().map(m => 
                                            `<label><input type="checkbox" value="${m}" onchange="updateMultiselectFilter(${scheduleIdx}, 'manufacturer')"> ${m}</label>`
                                        ).join('')}
                                    </div>
                                </div>
                            </div>
                            <div class="filter-group">
                                <label class="filter-label">Charging:</label>
                                <div class="custom-multiselect" data-filter="charging" data-schedule="${scheduleIdx}">
                                    <div class="multiselect-trigger" onclick="toggleMultiselect(this)">
                                        <span class="multiselect-label">Select charging...</span>
                                        <span class="multiselect-arrow">▼</span>
                                    </div>
                                    <div class="multiselect-dropdown">
                                        <label><input type="checkbox" value="dcfc" onchange="updateMultiselectFilter(${scheduleIdx}, 'charging')"> Has DC Fast Charging</label>
                                        <label><input type="checkbox" value="ac" onchange="updateMultiselectFilter(${scheduleIdx}, 'charging')"> Has AC Level 2</label>
                                    </div>
                                </div>
                            </div>
                            <div class="sort-group" style="margin-left: 20px;">
                                <label class="filter-label">Sort By:</label>
                                <div class="custom-multiselect custom-sort-select" style="min-width: 220px;">
                                    <div class="multiselect-trigger" onclick="toggleSortDropdown(this)">
                                        <span class="multiselect-label" id="currentSortLabel-${scheduleIdx}">Price (Low to High)</span>
                                        <span class="multiselect-arrow">▼</span>
                                    </div>
                                    <div class="multiselect-dropdown">
                                        <div class="sort-option selected" data-value="price_asc" onclick="selectScheduleSortOption(${scheduleIdx}, 'price_asc', 'Price (Low to High)')">Price (Low to High)</div>
                                        <div class="sort-option" data-value="battery_asc" onclick="selectScheduleSortOption(${scheduleIdx}, 'battery_asc', 'Battery Size (Low to High)')">Battery Size (Low to High)</div>
                                        <div class="sort-option" data-value="charging_asc" onclick="selectScheduleSortOption(${scheduleIdx}, 'charging_asc', 'Charging Speed (Low to High)')">Charging Speed (Low to High)</div>
                                        <div class="sort-option" data-value="range_asc" onclick="selectScheduleSortOption(${scheduleIdx}, 'range_asc', 'Rated Range (Low to High)')">Rated Range (Low to High)</div>
                                        <div class="sort-option" data-value="passengers_asc" onclick="selectScheduleSortOption(${scheduleIdx}, 'passengers_asc', 'Passengers (Low to High)')">Passengers (Low to High)</div>
                                    </div>
                                </div>
                                <input type="hidden" id="sort-${scheduleIdx}" value="price_asc">
                            </div>
                            <div style="margin-top:0.5rem;"><button class="btn btn-sm btn-secondary" onclick="clearFiltersForSchedule(${scheduleIdx})">Clear All Filters</button></div>
                        </div>
                    </div>
                    
                    <div class="bus-cards-grid" id="buses-schedule-inline-${scheduleIdx}" data-all-buses='${JSON.stringify(compatibleBuses).replace(/'/g, "&#39;")}'>
                        ${compatibleBuses.length > 0 ? compatibleBuses.map(bus => renderBusCardForSchedule(bus, schedule, scheduleIdx, considerDegradation)).join('') : '<p class="text-muted">No compatible buses found for this schedule.</p>'}
                    </div>
                </div>
            </div>
        `;
    }).join('') : '');
    
    // Update the continue button state
    updateContinueToChargersButton();
}

function updateContinueToChargersButton() {
    const allBusesSelected = busSchedules.every(s => s.selectedBus);
    const btn = document.getElementById('continueToChargersBtn');
    if (btn) {
        btn.disabled = !allBusesSelected;
    }
}

function applyBusToAll(busId) {
    const bus = busesData.find(b => b.id === busId);
    if (!bus) return;
    
    const considerDegradation = document.getElementById('batteryDegradation')?.checked;
    
    // Apply to all compatible schedules
    busSchedules.forEach(schedule => {
        const totalMiles = schedule.trips.reduce((sum, t) => sum + t.miles, 0);
        const maxPassengers = Math.max(...schedule.trips.map(t => t.passengers));
        
        // Check if bus is compatible with this schedule
        if (bus.passengerCapacity && bus.passengerCapacity < maxPassengers) return;
        const effectiveRange = calculateEffectiveRangeForSchedule(bus, schedule, depotClimate, considerDegradation);
        if (!effectiveRange || effectiveRange < totalMiles) return;
        
        // Apply the bus
        schedule.selectedBus = bus;
    });
    
    // Re-render the page to show the selections with collapsed fleet section
    renderBusSelectionPage();
    
    // Scroll to show the routes
    setTimeout(() => {
        const firstRoute = document.querySelector('.bus-schedule-selection-section');
        if (firstRoute) {
            firstRoute.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 100);
}

function chooseBusSelectionStrategy(strategy) {
    window.busSelectionStrategy = strategy;
    renderBusSelectionPage();
    
    // Scroll to top to see the new section
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetBusSelectionStrategy() {
    window.busSelectionStrategy = null;
    // Clear all bus selections
    busSchedules.forEach(s => s.selectedBus = null);
    renderBusSelectionPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showFleetStandardization() {
    const content = document.getElementById('fleetStandardizationContent');
    if (content) {
        content.style.display = 'block';
        setTimeout(() => {
            content.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

function toggleFleetStandardization() {
    const content = document.getElementById('fleetStandardizationContent');
    const btn = document.getElementById('toggleFleetStandardizationBtn');
    
    if (content && content.style.display === 'none') {
        content.style.display = 'block';
        if (btn) btn.textContent = 'Choose Each Bus Manually Instead ↓';
    } else if (content) {
        content.style.display = 'none';
        if (btn) btn.textContent = 'Show Fleet Standardization Options ↑';
        // Scroll to individual routes
        setTimeout(() => {
            const firstRoute = document.querySelector('.bus-schedule-selection-section');
            if (firstRoute) {
                firstRoute.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    }
}

function filterFleetBuses() {
    const grid = document.getElementById('fleet-buses-grid');
    if (!grid) return;
    
    const allBusesData = JSON.parse(grid.getAttribute('data-all-buses'));
    const filters = document.querySelector('.bus-filters[data-schedule-index="fleet"]');
    
    // Get selected filters from custom multiselects
    const typeMultiselect = filters.querySelector('.custom-multiselect[data-filter="type"]');
    const mfrMultiselect = filters.querySelector('.custom-multiselect[data-filter="manufacturer"]');
    const chargingMultiselect = filters.querySelector('.custom-multiselect[data-filter="charging"]');
    
    const selectedTypes = typeMultiselect ? Array.from(typeMultiselect.querySelectorAll('input:checked')).map(cb => cb.value) : [];
    const selectedManufacturers = mfrMultiselect ? Array.from(mfrMultiselect.querySelectorAll('input:checked')).map(cb => cb.value) : [];
    const chargingSelected = chargingMultiselect ? Array.from(chargingMultiselect.querySelectorAll('input:checked')).map(cb => cb.value) : [];
    
    const dcfcChecked = chargingSelected.includes('dcfc');
    const acChecked = chargingSelected.includes('ac');
    
    // Filter buses
    let filteredBuses = allBusesData.filter(bus => {
        if (selectedTypes.length > 0 && !selectedTypes.includes(bus.busType)) return false;
        if (selectedManufacturers.length > 0 && !selectedManufacturers.includes(bus.manufacturer)) return false;
        if (dcfcChecked && !bus.dcfcCapable) return false;
        if (acChecked && !bus.level2Capable) return false;
        return true;
    });

    // Sort buses
    const sortInput = document.getElementById('fleetSort');
    const sortValue = sortInput ? sortInput.value : 'price_asc';
    filteredBuses = sortBuses(filteredBuses, sortValue);
    
    // Re-render filtered buses
    const considerDegradation = document.getElementById('batteryDegradation')?.checked;
    grid.innerHTML = filteredBuses.map(bus => {
        const isUsedByAll = busSchedules.every(s => s.selectedBus && s.selectedBus.id === bus.id);
        const priceMin = bus.priceRange?.min || 0;
        const priceMax = bus.priceRange?.max || 0;
        const priceDisplay = priceMax > 0 
            ? `$${(priceMin/1000).toFixed(0)}k - $${(priceMax/1000).toFixed(0)}k`
            : 'Contact for pricing';
        const dcfcSpeed = bus.maxVehicleAcceptanceRate?.dcfc || 'N/A';
        const level2Speed = bus.maxVehicleAcceptanceRate?.level2 || 'N/A';
        const batteryWarranty = bus.warranty?.battery || 'Contact manufacturer';
        
        // Calculate range utilization for the longest route
        const maxRouteMiles = Math.max(...busSchedules.map(s => s.trips.reduce((sum, t) => sum + t.miles, 0)));
        // Find the schedule with max miles to calculate effective range accurately
        const maxSchedule = busSchedules.find(s => s.trips.reduce((sum, t) => sum + t.miles, 0) === maxRouteMiles);
        const effectiveRange = calculateEffectiveRangeForSchedule(bus, maxSchedule, depotClimate, considerDegradation);
        
        const rangeMargin = effectiveRange - maxRouteMiles;
        const rangePercent = ((maxRouteMiles / effectiveRange) * 100).toFixed(0);

        return `
            <div class="bus-card ${isUsedByAll ? 'selected' : ''}" onclick="applyBusToAll('${bus.id}')" style="cursor: pointer;">
                ${isUsedByAll ? '<div class="selected-checkmark">✓ Applied to All</div>' : '<div class="select-prompt">Click to apply to all routes</div>'}
                <div class="bus-card-header">
                    <div>
                        <div class="bus-title">${bus.manufacturer} ${bus.model}</div>
                        <div class="bus-subtitle">${bus.busType} • ${bus.passengerCapacity} seats</div>
                    </div>
                    <div class="bus-type-badge">${bus.busType}</div>
                </div>
                <div class="bus-specs">
                    <div class="spec-item">
                        <span class="spec-label">Battery Capacity</span>
                        <span class="spec-value">${bus.batteryCapacity} kWh</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">Rated Range</span>
                        <span class="spec-value">${bus.rangeRated} mi</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">Effective Range</span>
                        <span class="spec-value">${effectiveRange.toFixed(0)} mi</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">Price Range</span>
                        <span class="spec-value">${priceDisplay}</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">DC Fast Charging</span>
                        <span class="spec-value">${dcfcSpeed} kW</span>
                    </div>
                    <div class="spec-item">
                        <span class="spec-label">AC Level 2</span>
                        <span class="spec-value">${level2Speed} kW</span>
                    </div>
                    <div class="spec-item" style="grid-column: span 2;">
                        <span class="spec-label">Battery Warranty</span>
                        <span class="spec-value">${batteryWarranty}</span>
                    </div>
                </div>
                
                <div class="range-indicator" style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;">
                    <div class="range-indicator-label">
                        <span>Range Utilization:</span>
                        <span>${rangePercent}% (${maxRouteMiles} mi / ${effectiveRange.toFixed(0)} mi)</span>
                    </div>
                    <div class="range-bar">
                        <div class="range-fill ${rangePercent > 90 ? 'danger' : rangePercent > 80 ? 'warning' : ''}" 
                                style="width: ${Math.min(rangePercent, 100)}%">
                            ${rangePercent}%
                        </div>
                    </div>
                    <div style="margin-top: 8px; font-size: 0.875rem; ${rangeMargin < 20 ? 'color: var(--danger-color); font-weight: 600;' : 'color: var(--success-color);'}">
                        ${rangeMargin >= 0 
                            ? `✓ ${rangeMargin.toFixed(0)} mi safety margin` 
                            : `⚠ ${Math.abs(rangeMargin).toFixed(0)} mi SHORT - Choose larger bus`}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function sortFleetBuses() {
    filterFleetBuses();
}

function toggleSortDropdown(trigger) {
    const dropdown = trigger.nextElementSibling;
    const isOpen = dropdown.classList.contains('show');
    
    // Close all other dropdowns
    document.querySelectorAll('.multiselect-dropdown.show').forEach(d => {
        d.classList.remove('show');
        if (d.previousElementSibling) d.previousElementSibling.classList.remove('active');
    });
    
    if (!isOpen) {
        dropdown.classList.add('show');
        trigger.classList.add('active');
    }
}

function selectSortOption(value, label) {
    const input = document.getElementById('fleetSort');
    const labelSpan = document.getElementById('currentSortLabel');
    
    if (input) input.value = value;
    if (labelSpan) labelSpan.textContent = label;
    
    // Update UI selection state
    document.querySelectorAll('.sort-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.getAttribute('data-value') === value) {
            opt.classList.add('selected');
        }
    });
    
    // Close dropdown
    const dropdown = document.querySelector('.custom-sort-select .multiselect-dropdown');
    const trigger = document.querySelector('.custom-sort-select .multiselect-trigger');
    if (dropdown) dropdown.classList.remove('show');
    if (trigger) trigger.classList.remove('active');
    
    // Trigger sort
    sortFleetBuses();
}

function selectScheduleSortOption(scheduleIdx, value, label) {
    const input = document.getElementById(`sort-${scheduleIdx}`);
    const labelSpan = document.getElementById(`currentSortLabel-${scheduleIdx}`);
    
    if (input) input.value = value;
    if (labelSpan) labelSpan.textContent = label;
    
    // Update UI selection state within this specific dropdown
    const container = input.closest('.sort-group');
    if (container) {
        container.querySelectorAll('.sort-option').forEach(opt => {
            opt.classList.remove('selected');
            if (opt.getAttribute('data-value') === value) {
                opt.classList.add('selected');
            }
        });
        
        // Close dropdown
        const dropdown = container.querySelector('.multiselect-dropdown');
        const trigger = container.querySelector('.multiselect-trigger');
        if (dropdown) dropdown.classList.remove('show');
        if (trigger) trigger.classList.remove('active');
    }
    
    // Trigger filter/sort
    filterBusesForSchedule(scheduleIdx);
}

function sortBuses(buses, sortValue) {
    return [...buses].sort((a, b) => {
        // Helper to check for "no data" values (null, undefined, 0, "N/A")
        const isNoData = (val) => val === null || val === undefined || val === 0 || val === 'N/A';
        
        // For ascending sort: Valid values (Low -> High), then No Data
        const compareAsc = (valA, valB) => {
            if (isNoData(valA) && isNoData(valB)) return 0;
            if (isNoData(valA)) return 1; // A has no data, put it last
            if (isNoData(valB)) return -1; // B has no data, put it last
            return valA - valB;
        };

        switch (sortValue) {
            case 'price_asc':
                return compareAsc(a.priceRange?.min, b.priceRange?.min);
                
            case 'battery_asc':
                return compareAsc(a.batteryCapacity, b.batteryCapacity);
                
            case 'charging_asc':
                const getCharge = (bus) => Math.max(bus.maxVehicleAcceptanceRate?.dcfc || 0, bus.maxVehicleAcceptanceRate?.level2 || 0);
                return compareAsc(getCharge(a), getCharge(b));
                
            case 'range_asc':
                return compareAsc(a.rangeRated, b.rangeRated);
                
            case 'passengers_asc':
                return compareAsc(a.passengerCapacity, b.passengerCapacity);
                
            default:
                return 0;
        }
    });
}

function clearFleetFilters() {
    const filters = document.querySelector('.bus-filters[data-schedule-index="fleet"]');
    if (!filters) return;
    
    // Clear all checkboxes in multiselects
    filters.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    
    // Reset all multiselect labels
    filters.querySelectorAll('.custom-multiselect').forEach(multiselect => {
        const filterType = multiselect.getAttribute('data-filter');
        const label = multiselect.querySelector('.multiselect-label');
        label.textContent = `Select ${filterType}...`;
        label.classList.remove('has-selection');
    });
    
    // Re-render with all buses
    filterFleetBuses();
}

function expandBusSelection(scheduleIdx) {
    const expandable = document.getElementById(`bus-selection-expandable-${scheduleIdx}`);
    const btn = document.getElementById(`expand-bus-btn-${scheduleIdx}`);
    
    if (expandable) {
        expandable.style.display = 'block';
        if (btn) btn.style.display = 'none';
        
        // Scroll to the expanded section
        setTimeout(() => {
            expandable.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

// Multi-select dropdown functions
function toggleMultiselect(triggerElement) {
    const dropdown = triggerElement.nextElementSibling;
    const isCurrentlyOpen = dropdown.classList.contains('show');
    
    // Close all other dropdowns
    document.querySelectorAll('.multiselect-dropdown.show').forEach(d => {
        d.classList.remove('show');
        d.previousElementSibling.classList.remove('active');
    });
    
    // Toggle current dropdown
    if (!isCurrentlyOpen) {
        dropdown.classList.add('show');
        triggerElement.classList.add('active');
    }
}

function updateMultiselectFilter(scheduleIdx, filterType) {
    const schedule = scheduleIdx === 'fleet' ? 'fleet' : scheduleIdx;
    const multiselect = document.querySelector(`.custom-multiselect[data-filter="${filterType}"][data-schedule="${schedule}"]`);
    
    if (!multiselect) return;
    
    const checkboxes = multiselect.querySelectorAll('input[type="checkbox"]:checked');
    const selectedValues = Array.from(checkboxes).map(cb => cb.value);
    const trigger = multiselect.querySelector('.multiselect-trigger');
    const label = trigger.querySelector('.multiselect-label');
    
    // Update label text
    if (selectedValues.length === 0) {
        label.textContent = `Select ${filterType}...`;
        label.classList.remove('has-selection');
    } else {
        label.textContent = `${selectedValues.length} selected`;
        label.classList.add('has-selection');
    }
    
    // Apply filter
    if (schedule === 'fleet') {
        filterFleetBuses();
    } else {
        filterBusesForSchedule(schedule);
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(event) {
    if (!event.target.closest('.custom-multiselect')) {
        document.querySelectorAll('.multiselect-dropdown.show').forEach(dropdown => {
            dropdown.classList.remove('show');
            dropdown.previousElementSibling.classList.remove('active');
        });
    }
});

function renderChargerScenariosPage() {
    // Calculate charger scenarios based on selected buses
    const selectedBuses = busSchedules.map(s => s.selectedBus);
    const allTrips = busSchedules.flatMap(s => s.trips);
    const chargerScenarios = optimizeChargers(selectedBuses, allTrips, depotClimate);
    
    const container = document.getElementById('chargerScenariosGrid');
    container.innerHTML = Object.entries(chargerScenarios).map(([key, scenario]) => {
        const isSelected = selectedChargerScenario === key;
        const totalChargers = scenario.chargers.reduce((sum, c) => sum + (c.quantity || 0), 0);
        const totalEquipmentCost = scenario.totalCost || 0;
        const totalInstallCost = scenario.estimatedInstallCost || 0;
        const grandTotal = totalEquipmentCost + totalInstallCost;
        
        return `
            <div class="charger-scenario-card ${isSelected ? 'selected' : ''}" onclick="selectChargerScenario('${key}')">
                <h3 class="scenario-title">${scenario.name}</h3>
                <p class="scenario-description">${scenario.description}</p>
                
                <div class="scenario-details">
                    <div class="scenario-detail-row">
                        <span class="scenario-detail-label">Total Chargers:</span>
                        <span class="scenario-detail-value">${totalChargers}</span>
                    </div>
                    <div class="scenario-detail-row">
                        <span class="scenario-detail-label">Equipment Cost:</span>
                        <span class="scenario-detail-value">$${(totalEquipmentCost / 1000).toFixed(0)}k</span>
                    </div>
                    <div class="scenario-detail-row">
                        <span class="scenario-detail-label">Installation Cost:</span>
                        <span class="scenario-detail-value">$${(totalInstallCost / 1000).toFixed(0)}k</span>
                    </div>
                    <div class="scenario-detail-row" style="font-size: 1.05rem; margin-top: 10px; padding-top: 10px; border-top: 2px solid var(--border-color);">
                        <span class="scenario-detail-label" style="font-weight: 700;">Total Investment:</span>
                        <span class="scenario-detail-value" style="color: var(--primary-color); font-size: 1.15rem;">$${(grandTotal / 1000).toFixed(0)}k</span>
                    </div>
                </div>
                
                ${scenario.chargers.length > 0 ? `
                <div class="scenario-chargers-list">
                    ${scenario.chargers.filter(c => c && c.chargingType).map(c => {
                        const power = c.kw || c.kwMax || 'N/A';
                        const type = c.chargingType || 'Unknown';
                        
                        // Calculate individual costs
                        const avgEquipmentCost = (c.priceRange.min + c.priceRange.max) / 2;
                        const installCostMap = { '$': 5000, '$$': 15000, '$$$': 35000, '$$$$': 75000 };
                        const installCost = installCostMap[c.infrastructureCost] || 10000;
                        
                        return `
                        <div class="scenario-charger-item">
                            <div>
                                <div class="scenario-charger-name">${type} - ${power} kW</div>
                                ${c.reason ? `<div style="font-size: 0.85rem; color: var(--text-secondary); font-style: italic; margin-top: 4px;">${c.reason}</div>` : ''}
                                <div style="font-size: 0.8rem; color: #666; margin-top: 4px; line-height: 1.4;">
                                    Equip: $${(avgEquipmentCost/1000).toFixed(1)}k<br>
                                    Install: $${(installCost/1000).toFixed(1)}k
                                </div>
                            </div>
                            <div class="scenario-charger-qty">×${c.quantity}</div>
                        </div>
                        `;
                    }).join('')}
                </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    // Store scenarios for later use
    currentResults = {
        busSchedules: busSchedules,
        chargers: chargerScenarios,
        selectedBuses: selectedBuses,
        trips: allTrips
    };
}

function selectChargerScenario(scenarioKey) {
    selectedChargerScenario = scenarioKey;
    
    // Re-render to show selection
    renderChargerScenariosPage();
    
    // Enable the view results button
    const btn = document.getElementById('viewResultsBtn');
    if (btn) {
        btn.disabled = false;
    }
}

function renderResultsPage() {
    // Display fleet summary
    displaySelectedFleetSummary(currentResults);
    
    // Display selected buses
    displaySelectedBuses(currentResults.selectedBuses);
    
    // Display chosen charger scenario
    displaySelectedChargerScenario();
    
    // Display charts
    displayCharts(currentResults);
}

function displaySelectedChargerScenario() {
    if (!selectedChargerScenario || !currentResults) return;
    
    const container = document.getElementById('selectedChargerScenario');
    const scenario = currentResults.chargers[selectedChargerScenario];
    
    if (!scenario) return;
    
    const totalChargers = scenario.chargers.reduce((sum, c) => sum + (c.quantity || 0), 0);
    const totalEquipmentCost = scenario.totalCost || 0;
    const totalInstallCost = scenario.estimatedInstallCost || 0;
    const grandTotal = totalEquipmentCost + totalInstallCost;
    
    container.innerHTML = `
        <div class="selected-scenario-display">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <div>
                    <h3 style="color: var(--primary-color); margin: 0;">${scenario.name}</h3>
                    <p style="color: var(--text-secondary); margin: 5px 0 0 0;">${scenario.description}</p>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 0.875rem; color: var(--text-secondary);">Total Investment</div>
                    <div style="font-size: 2rem; font-weight: 700; color: var(--primary-color);">$${(grandTotal / 1000).toFixed(0)}k</div>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                <div class="summary-card">
                    <span class="summary-label">Total Chargers</span>
                    <span class="summary-value">${totalChargers}</span>
                </div>
                <div class="summary-card">
                    <span class="summary-label">Equipment Cost</span>
                    <span class="summary-value">$${(totalEquipmentCost / 1000).toFixed(0)}k</span>
                </div>
                <div class="summary-card">
                    <span class="summary-label">Installation Cost</span>
                    <span class="summary-value">$${(totalInstallCost / 1000).toFixed(0)}k</span>
                </div>
            </div>
            
            ${scenario.chargers.length > 0 ? `
                <div>
                    <h4 style="margin-bottom: 15px;">Charger Equipment:</h4>
                    <div style="display: grid; gap: 10px;">
                        ${scenario.chargers.filter(c => c && c.chargingType).map(c => {
                            const avgCost = (c.priceRange.min + c.priceRange.max) / 2;
                            const power = c.kw || c.kwMax || 'N/A';
                            const type = c.chargingType || 'Unknown';
                            
                            // Calculate installation cost
                            const installCostMap = { '$': 5000, '$$': 15000, '$$$': 35000, '$$$$': 75000 };
                            const installCost = installCostMap[c.infrastructureCost] || 10000;
                            
                            return `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: var(--bg-light); border-radius: var(--border-radius);">
                                    <div style="flex: 1;">
                                        <div style="font-weight: 600; margin-bottom: 5px;">${type} - ${power} kW</div>
                                        <div style="font-size: 0.875rem; color: var(--text-secondary);">
                                            ${c.reason ? `<em>${c.reason}</em>` : ''}
                                        </div>
                                    </div>
                                    <div style="text-align: right;">
                                        <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary-color);">×${c.quantity}</div>
                                        <div style="font-size: 0.875rem; color: var(--text-secondary); line-height: 1.4;">
                                            $${(avgCost / 1000).toFixed(1)}k equip<br>
                                            $${(installCost / 1000).toFixed(1)}k install
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

// ==========================
// Wizard Navigation
// ==========================
function confirmStartOver() {
    if (confirm("Are you sure you want to clear all data and start over? This action cannot be undone.")) {
        // Reset State
        completedSteps = new Set([1]);
        selectedChargerScenario = null;
        busSchedules = [];
        nextBusScheduleId = 1;
        depotClimate = null;
        currentResults = null;
        
        // Reset UI Inputs
        const weatherCheck = document.getElementById('considerWeather');
        if (weatherCheck) weatherCheck.checked = false;
        
        const depotLoc = document.getElementById('depotLocation');
        if (depotLoc) depotLoc.value = '';
        
        const depotContainer = document.getElementById('depotLocationContainer');
        if (depotContainer) depotContainer.style.display = 'none';
        
        const terrainCheck = document.getElementById('considerTerrain');
        if (terrainCheck) terrainCheck.checked = false;
        
        const terrainType = document.getElementById('terrainType');
        if (terrainType) terrainType.value = 'flat';
        
        const terrainContainer = document.getElementById('terrainContainer');
        if (terrainContainer) terrainContainer.style.display = 'none';
        
        const batteryCheck = document.getElementById('batteryDegradation');
        if (batteryCheck) batteryCheck.checked = false;
        
        // Clear bus schedules list
        const schedulesContainer = document.getElementById('busSchedulesList');
        if (schedulesContainer) schedulesContainer.innerHTML = '';
        
        // Navigate to Step 1
        navigateToStep(1);
    }
}

function navigateToStep(step) {
    // Check if step is accessible
    if (!completedSteps.has(step) && step !== currentStep + 1) {
        return;
    }
    
    // Hide current page
    const currentPage = document.getElementById(`page${currentStep}`);
    if (currentPage) {
        currentPage.classList.remove('active');
        currentPage.style.display = 'none';
    }
    
    // Show new page
    const newPage = document.getElementById(`page${step}`);
    if (newPage) {
        newPage.classList.add('active');
        newPage.style.display = 'block';
        
        // Scroll to top immediately
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
    }
    
    // Update current step
    currentStep = step;
    
    // Update breadcrumb UI
    updateBreadcrumbs();
    
    // Execute page-specific logic
    if (step === 3) {
        renderBusSelectionPage();
    } else if (step === 4) {
        renderChargerScenariosPage();
    } else if (step === 5) {
        renderResultsPage();
    }
}

function updateBreadcrumbs() {
    const breadcrumbSteps = document.querySelectorAll('.breadcrumb-step');
    
    breadcrumbSteps.forEach((btn, idx) => {
        const stepNum = idx + 1;
        btn.classList.remove('active', 'completed');
        
        if (stepNum === currentStep) {
            btn.classList.add('active');
            btn.disabled = false;
        } else if (completedSteps.has(stepNum)) {
            btn.classList.add('completed');
            btn.disabled = false;
        } else {
            btn.disabled = true;
        }
    });
}

function goToNextStep() {
    // Validate current step before proceeding
    if (!validateCurrentStep()) {
        return;
    }
    
    // Mark current step as completed
    completedSteps.add(currentStep);
    
    // Navigate to next step
    const nextStep = currentStep + 1;
    if (nextStep <= 5) {
        navigateToStep(nextStep);
    }
}

function goToPreviousStep() {
    const prevStep = currentStep - 1;
    if (prevStep >= 1) {
        navigateToStep(prevStep);
    }
}

function validateCurrentStep() {
    switch (currentStep) {
        case 1:
            // Fleet config is always valid (optional fields)
            return true;
            
        case 2:
            // Must have at least one bus schedule
            if (busSchedules.length === 0) {
                alert('Please add at least one bus schedule before continuing.');
                return false;
            }
            return true;
            
        case 3:
            // All schedules must have a selected bus
            const allBusesSelected = busSchedules.every(s => s.selectedBus);
            if (!allBusesSelected) {
                alert('Please select a bus for each schedule before continuing.');
                return false;
            }
            return true;
            
        case 4:
            // Must select a charger scenario
            if (!selectedChargerScenario) {
                alert('Please select a charger scenario before viewing results.');
                return false;
            }
            return true;
            
        default:
            return true;
    }
}

// ==========================
// Event Listeners
// ==========================
function initializeApp() {
    // Load data
    loadData();
    
    // Initialize wizard
    navigateToStep(1);
    
    // Force checkboxes to default to unchecked
    ['considerWeather', 'considerTerrain', 'batteryDegradation'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
    });
    
    // Ensure dependent containers are hidden
    const depotContainer = document.getElementById('depotLocationContainer');
    if (depotContainer) depotContainer.style.display = 'none';
    
    const terrainContainer = document.getElementById('terrainContainer');
    if (terrainContainer) terrainContainer.style.display = 'none';
    
    // Add bus schedule button
    const addBusBtn = document.getElementById('addBusScheduleBtn');
    if (addBusBtn) addBusBtn.addEventListener('click', openAddBusScheduleModal);
    
    // Modal controls
    const closeBtn = document.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    
    const cancelBtn = document.getElementById('cancelBusScheduleBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    
    const saveBtn = document.getElementById('saveBusScheduleBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveBusSchedule);
    
    // Close modal on outside click
    const modal = document.getElementById('busScheduleModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'busScheduleModal') {
                closeModal();
            }
        });
    }
    
    // Depot location - detect climate on blur
    const depotInput = document.getElementById('depotLocation');
    if (depotInput) {
        depotInput.addEventListener('blur', async (e) => {
            const location = e.target.value;
            if (location) {
                depotClimate = await detectClimate(location);
                updateClimateDisplay();
            }
        });
    }

    // Toggle Weather Container
    const weatherCheckbox = document.getElementById('considerWeather');
    if (weatherCheckbox) {
        weatherCheckbox.addEventListener('change', (e) => {
            const container = document.getElementById('depotLocationContainer');
            if (container) container.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    // Toggle Terrain Container
    const terrainCheckbox = document.getElementById('considerTerrain');
    if (terrainCheckbox) {
        terrainCheckbox.addEventListener('change', (e) => {
            const container = document.getElementById('terrainContainer');
            if (container) container.style.display = e.target.checked ? 'block' : 'none';
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// ==========================
// Global Exports
// ==========================
// Expose functions to the global window object so HTML onclick attributes can find them
Object.assign(window, {
    goToNextStep,
    goToPreviousStep,
    navigateToStep,
    confirmStartOver,
    saveBusSchedulesToFile,
    loadBusSchedulesFromFile,
    toggleMultiselect,
    updateMultiselectFilter,
    clearFleetFilters,
    sortFleetBuses,
    toggleSortDropdown,
    selectSortOption,
    applyBusToAll,
    resetBusSelectionStrategy,
    toggleBusSelectionForSchedule,
    expandBusSelection,
    clearFiltersForSchedule,
    selectChargerScenario,
    renderBusCardForSchedule,
    addTripToModal,
    updateModalTrip,
    removeTripFromModal,
    chooseBusSelectionStrategy,
    showFleetStandardization,
    toggleFleetStandardization,
    selectBusForSchedule,
    openEditBusScheduleModal,
    deleteBusSchedule,
    selectScheduleSortOption
});

