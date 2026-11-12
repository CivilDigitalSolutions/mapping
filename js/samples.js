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
