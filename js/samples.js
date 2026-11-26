// Built-in example datasets so people can try the app without their own file.
// Each one deliberately uses a different layout to show what the importer understands.

export const SAMPLES = [
  {
    name: 'Sample: Vehicle 1 (ISO date-times)',
    style: { shape: 'circle', color: '#0072B2', showLine: true, lineOrder: 'time', numbered: true },
    text: `Vehicle,Latitude,Longitude,Timestamp,Speed (km/h)
VAN-01,51.50135,-0.14189,2024-03-14T08:00:00Z,0
VAN-01,51.50330,-0.13510,2024-03-14T08:06:00Z,22
VAN-01,51.50728,-0.12763,2024-03-14T08:13:00Z,31
VAN-01,51.50806,-0.12000,2024-03-14T08:19:00Z,18
VAN-01,51.51127,-0.11655,2024-03-14T08:26:00Z,25
VAN-01,51.51338,-0.10900,2024-03-14T08:34:00Z,29
VAN-01,51.51384,-0.09840,2024-03-14T08:41:00Z,12
VAN-01,51.51203,-0.09062,2024-03-14T08:49:00Z,20
VAN-01,51.50998,-0.08600,2024-03-14T08:55:00Z,27
VAN-01,51.50812,-0.07600,2024-03-14T09:04:00Z,0`,
  },
  {
    name: 'Sample: Survey crew (separate date and time)',
    timeZone: 'Europe/London', // the times in this file are UK local time
    style: { shape: 'square', color: '#D55E00', showLine: true, lineOrder: 'time', lineStyle: 'dashed' },
    text: `Point,Location,Date,Time,Notes
S1,"51.4995, -0.1248",14/03/2024,09:10,Start of survey
S2,"51.4960, -0.1205",14/03/2024,09:32,Kerb damage
S3,"51.4921, -0.1162",14/03/2024,10:05,
S4,"51.4877, -0.1110",14/03/2024,10:41,Drainage blocked
S5,"51.4842, -0.1043",14/03/2024,11:20,
S6,"51.4869, -0.0975",14/03/2024,13:02,After lunch
S7,"51.4913, -0.0922",14/03/2024,13:47,Lighting column fault
S8,"51.4966, -0.0891",14/03/2024,14:30,End of survey`,
  },
  {
    name: 'Sample: Sites (degrees, minutes, seconds)',
    style: { shape: 'pin', color: '#009E73', showLine: false },
    text: `Name,Lat,Lon,Category
Depot North,51°31'22"N,0°07'35"W,Depot
Depot South,51°28'40"N,0°06'10"W,Depot
Yard East,51°30'25"N,0°04'05"W,Yard
Office,51°30'45"N,0°08'20"W,Office`,
  },
];

// A cell site (mast) example for the cell sites preview. It is kept apart from SAMPLES so the
// ordinary "Try sample data" button doesn't draw sectors over the other examples.
// One row per antenna sector: Azimuth is the compass direction it faces (degrees clockwise
// from north), Beamwidth how wide it spreads (360 = all-round) and Radius how far it reaches.
// LDN007 has no beamwidth and LDN008 no radius, to show the defaults being used.
export const CELL_SAMPLE = {
  name: 'Sample: Cell sites (azimuth, beamwidth, radius)',
  style: { shape: 'triangle', color: '#CC79A7', size: 18, showLine: false },
  cell: { on: true, az: 'Azimuth', beam: 'Beamwidth', radius: 'Radius (m)', defaultBeam: 65, defaultRadius: 600, unit: 'm' },
  text: `Site,Sector,Latitude,Longitude,Azimuth,Beamwidth,Radius (m),Technology
LDN001 Westminster,A,51.50070,-0.12460,30,65,800,4G
LDN001 Westminster,B,51.50070,-0.12460,150,65,800,4G
LDN001 Westminster,C,51.50070,-0.12460,270,65,800,4G
LDN002 Holborn,A,51.51740,-0.12000,0,60,600,5G
LDN002 Holborn,B,51.51740,-0.12000,120,60,600,5G
LDN002 Holborn,C,51.51740,-0.12000,240,60,600,5G
LDN003 City,A,51.51360,-0.08900,45,65,700,4G
LDN003 City,B,51.51360,-0.08900,165,65,700,4G
LDN003 City,C,51.51360,-0.08900,285,65,700,4G
LDN004 Southwark,A,51.50450,-0.08650,90,70,900,4G
LDN004 Southwark,B,51.50450,-0.08650,210,70,900,4G
LDN004 Southwark,C,51.50450,-0.08650,330,70,900,4G
LDN005 Marylebone,A,51.52050,-0.15500,20,65,1000,5G
LDN005 Marylebone,B,51.52050,-0.15500,140,65,1000,5G
LDN005 Marylebone,C,51.52050,-0.15500,260,65,1000,5G
LDN006 Waterloo (small cell),O,51.50310,-0.11320,0,360,300,5G
LDN007 Mayfair,A,51.51100,-0.14400,60,,500,4G
LDN007 Mayfair,B,51.51100,-0.14400,180,,500,4G
LDN007 Mayfair,C,51.51100,-0.14400,300,,500,4G
LDN008 Bermondsey,A,51.49800,-0.07800,15,65,,3G
LDN008 Bermondsey,B,51.49800,-0.07800,135,65,,3G
LDN008 Bermondsey,C,51.49800,-0.07800,255,65,,3G`,
};
