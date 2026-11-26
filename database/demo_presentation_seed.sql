-- =============================================================================
-- database/demo_presentation_seed.sql
-- SMaRT Operations Platform — Executive Presentation Demo Dataset
-- =============================================================================
-- Scenario: Global Flight Simulation Training Center (Vendor-Neutral / International)
--   - 8 users across all 4 roles (admin, manager, tech, viewer)
--   - 6 Full Flight Simulators (A320neo, B737 MAX, A350-900, H145, AJT-50, B787-9)
--   - 6 Test Places (TP-01..TP-06) & 6 IOS Consoles (IOS-01..IOS-06)
--   - 48 simulator subsystems, 24 QTG compliance tests, 7 days of daily shift logs
--   - 28 flight sorties spanning -25d to +3d (including 6 live today on 24h timeline)
--   - 10 facility assets, 18 simulator/station/asset work orders & MEL snags (DR)
--   - 14 standalone Planned Maintenance schedules (Daily/Weekly/Monthly) + instances
--   - 14 aviation spares (AOG critical, Rotable LRUs, RMA, inbound POs w/ ETA) + 18 movements
--   - 14 days of workforce shift roster (MOR/AFT/NGT/CST/VAC) + 4 shift handovers
--   - 14 tasks (with parent/subtask hierarchy) + comments, 6 Markdown Wiki SOPs
--   - Live notifications & audit trail
--
-- ALL dates are dynamically anchored to CURDATE() so every dashboard widget,
-- 24h bay timeline, urgent alert center, MEL countdown, planned calendar, and
-- Daily / Weekly / Monthly / Custom report looks 100% live on ANY presentation date.
--
-- Demo Login Credentials:
--   Administrator : admin        / Admin@1234
--   Ops Manager   : sarah.chen   / Demo@1234
--   Lead Engineer : david.miller / Demo@1234
--   Auditor       : olivia.grant / Demo@1234
--
-- Manual Import:
--   1. (Optional) Run database/reset_clean_db.sql first for a fresh schema.
--   2. Import this file via Adminer, phpMyAdmin, MySQL Workbench, or CLI:
--      mysql -u root -p smart < database/demo_presentation_seed.sql
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET time_zone = '+00:00';

-- =============================================================================
-- 0. CLEAR OPERATIONAL DATA (safe for repeated re-imports before demos)
-- =============================================================================
TRUNCATE TABLE ui_table_column_preferences;
TRUNCATE TABLE ui_section_field_role_preferences;
TRUNCATE TABLE ui_section_field_preferences;
TRUNCATE TABLE ui_section_access_preferences;
TRUNCATE TABLE audit_logs;
TRUNCATE TABLE notifications;
TRUNCATE TABLE wiki_revisions;
TRUNCATE TABLE wiki_articles;
TRUNCATE TABLE task_comments;
TRUNCATE TABLE tasks;
TRUNCATE TABLE shift_handovers;
TRUNCATE TABLE shift_swap_requests;
TRUNCATE TABLE shifts;
TRUNCATE TABLE stock_movements;
TRUNCATE TABLE inventory_items;
TRUNCATE TABLE planned_maintenance_task_instances;
TRUNCATE TABLE planned_maintenance_tasks;
TRUNCATE TABLE maintenance_records;
TRUNCATE TABLE assets;
TRUNCATE TABLE operation_logs;
TRUNCATE TABLE operation_members;
TRUNCATE TABLE operations;
TRUNCATE TABLE simulator_shift_entries;
TRUNCATE TABLE simulator_daily_shifts;
TRUNCATE TABLE simulator_daily_logs;
TRUNCATE TABLE simulator_qtg_records;
TRUNCATE TABLE simulator_subsystems;
TRUNCATE TABLE simulators;
TRUNCATE TABLE refresh_tokens;
DELETE FROM users;
ALTER TABLE users AUTO_INCREMENT = 1;

-- =============================================================================
-- 1. SYSTEM MIGRATIONS & REFERENCE CATALOGS
-- =============================================================================
INSERT IGNORE INTO schema_migrations (id, name) VALUES
(1, '001_baseline_schema'),
(2, '002_add_part_number_to_inventory_items'),
(3, '003_create_planned_maintenance_tasks'),
(4, '004_create_ui_preferences'),
(5, '005_enhance_shifts_custom_and_leave'),
(6, '006_flight_simulator_domain'),
(7, '007_station_daily_ops'),
(8, '008_cae_enterprise_ops');

INSERT IGNORE INTO roles (id, name, description, permissions) VALUES
(1, 'admin',   'System Administrator',  '["*"]'),
(2, 'manager', 'Operations Manager',    '["read","write","manage_users"]'),
(3, 'tech',    'Technician',            '["read","write"]'),
(4, 'viewer',  'Read-only access',      '["read"]');

INSERT IGNORE INTO operation_types (id, name, color, icon, description) VALUES
(1, 'Type Rating',               '#1565C0', 'flight_takeoff', 'Initial or transition aircraft type rating training sortie'),
(2, 'Recurrent LPC / OPC',       '#0288D1', 'verified',       'Proficiency check and recurrent airline regulatory sortie'),
(3, 'LOFT Mission',              '#0F766E', 'alt_route',      'Line-Oriented Flight Training full scenario sortie'),
(4, 'Checkride / Exam',          '#7C3AED', 'school',         'Authority examiner skill test and ZFT qualification'),
(5, 'Mission Rehearsal',         '#4338CA', 'military_tech',  'Tactical, helicopter NVG/SAR, or specialized mission training'),
(6, 'QTG & Engineering Fly-Out', '#D97706', 'tune',           'Morning readiness fly-out or QTG validation flight');

INSERT IGNORE INTO shift_types (id, name, code, start_time, end_time, color, category, description) VALUES
(1, 'Morning',        'MOR', '06:00:00', '14:00:00', '#1565C0', 'WORK',  'Standard morning shift'),
(2, 'Afternoon',      'AFT', '14:00:00', '22:00:00', '#0288D1', 'WORK',  'Standard afternoon shift'),
(3, 'Night',          'NGT', '22:00:00', '06:00:00', '#01579B', 'WORK',  'Overnight shift'),
(4, 'On-Call',        'ONC', '00:00:00', '23:59:59', '#37474F', 'WORK',  '24h on-call coverage'),
(5, 'Custom Shift',   'CST', '08:00:00', '16:00:00', '#7C3AED', 'WORK',  'Custom schedule for overtime, early leave, or flexible hours'),
(6, 'Sick Leave',     'SCK', '00:00:00', '00:00:00', '#EF4444', 'LEAVE', 'Medical or sick leave'),
(7, 'Vacation',       'VAC', '00:00:00', '00:00:00', '#10B981', 'LEAVE', 'Planned annual vacation'),
(8, 'Public Holiday', 'HOL', '00:00:00', '00:00:00', '#F59E0B', 'LEAVE', 'National or company holiday'),
(9, 'Personal Leave', 'PRM', '00:00:00', '00:00:00', '#8B5CF6', 'LEAVE', 'Personal time off or permit');

INSERT IGNORE INTO warehouse_locations (id, name, code, description, is_active) VALUES
(1, 'Main Aviation Spares Vault', 'WH-MAIN', 'Primary climate-controlled spares storage', TRUE),
(2, 'Bay-Side Line Stock',        'BAY-STK', 'Fast-access bay line replacement spares', TRUE),
(3, 'Quarantine & RMA Bench',     'RMA-BAY', 'Unserviceable LRUs awaiting vendor RMA', TRUE),
(4, 'Calibrated Tooling Lab',     'CAL-LAB', 'Optical alignment & calibrated test equipment', TRUE);

INSERT IGNORE INTO asset_categories (id, name, type, description) VALUES
(1, 'Servers',             'HARDWARE', 'Host simulation servers and hypervisors'),
(2, 'Workstations',        'HARDWARE', 'Engineering and dispatch workstations'),
(3, 'Network Equipment',   'HARDWARE', 'Core switches, LVC gateways and firewalls'),
(4, 'Storage Devices',     'HARDWARE', 'SAN arrays and backup media libraries'),
(5, 'Power & HVAC',        'HARDWARE', 'UPS banks, bay PDUs and precision chillers'),
(6, 'Enterprise Software', 'SOFTWARE', 'Core telemetry and compliance suites'),
(7, 'Security & Safety',   'OTHER',    'Fire suppression, access control and LOTO panels');

INSERT IGNORE INTO task_categories (id, name, color, icon) VALUES
(1, 'Simulators & Bays', '#1565C0', 'flight_takeoff'),
(2, 'Safety & LOTO',     '#B71C1C', 'security'),
(3, 'Engineering',       '#1B5E20', 'build'),
(4, 'Logistics & RMA',   '#E65100', 'inventory_2'),
(5, 'QTG & Compliance',  '#4A148C', 'gavel');

INSERT IGNORE INTO wiki_categories (id, name, slug, icon, sort_order) VALUES
(1, 'Getting Started',   'getting-started',   'start',       1),
(2, 'Simulator Systems', 'simulator-systems', 'dns',         2),
(3, 'Safety & LOTO',     'safety-loto',       'lock',        3),
(4, 'SOPs & Runbooks',   'sops',              'description', 4),
(5, 'Troubleshooting',   'troubleshooting',   'build',       5);

INSERT IGNORE INTO item_categories (id, name, description, color) VALUES
(1, 'Visual & Laser Optics',     'Projectors, laser modules, mirrors and collimation parts', '#0288D1'),
(2, 'Motion & Actuation LRUs',   'Electric motion actuators, servo drives, seals and sensors', '#1565C0'),
(3, 'Avionics & Host Compute',   'Host blades, GPUs, ARINC 429 boards and cockpit displays', '#7C3AED'),
(4, 'Control Loading & Cockpit', 'CLS sensors, sidesticks, throttles, headsets and switches', '#0F766E'),
(5, 'Consumables & Filters',     'HVAC filters, cooling fluids, cables, fuses and fasteners', '#D97706'),
(6, 'Calibrated Tooling',        'Photometers, torque wrenches and optical calibration rigs', '#37474F');

-- =============================================================================
-- 2. USERS & CERTIFIED ENGINEERING CREW (8 users)
--    admin       -> Admin@1234
--    other users -> Demo@1234
-- =============================================================================
INSERT INTO users
  (id, role_id, username, email, password_hash, first_name, last_name, department, job_title, phone, is_active, certifications, last_login)
VALUES
(1, 1, 'admin',          'admin@smart.local',            '$2a$10$rZUO5AEvFPhymrjKuac.QuNWfwqgfzJ6UHc8m3q.Y/bIOsymF8z7u', 'Alex',   'Morgan',  'Operations & IT',      'Training Center Systems Admin',   '+1-555-0101', TRUE, '["Platform Admin","FSTD Operations","ISO 27001"]',                          DATE_SUB(NOW(), INTERVAL 25 MINUTE)),
(2, 2, 'sarah.chen',     'sarah.chen@smart-demo.local',  '$2a$10$Mlp3VMrzeZMkCXUNYsBOuOehSA6VJZvQRf/IjW69n3T5SUtYOPzju', 'Sarah',  'Chen',    'Flight Training Ops',  'Head of Training Center Ops',     '+1-555-0102', TRUE, '["FSTD Compliance Manager","Part-ORA Postholder","SMS Lead"]',              DATE_SUB(NOW(), INTERVAL 1 HOUR)),
(3, 3, 'david.miller',   'david.miller@smart-demo.local','$2a$10$Mlp3VMrzeZMkCXUNYsBOuOehSA6VJZvQRf/IjW69n3T5SUtYOPzju', 'David',  'Miller',  'FSTD Engineering',     'Lead Simulator Engineer',         '+1-555-0103', TRUE, '["Level D FFS Lead","QTG Sign-Off Authority","HV LOTO Authorized"]',        DATE_SUB(NOW(), INTERVAL 2 HOUR)),
(4, 3, 'claire.bennett', 'claire.bennett@smart-demo.local','$2a$10$Mlp3VMrzeZMkCXUNYsBOuOehSA6VJZvQRf/IjW69n3T5SUtYOPzju','Claire','Bennett', 'Visual & Avionics',    'Senior Visual & Avionics Eng.',   '+1-555-0104', TRUE, '["OptiDome 4K Laser","Optical Collimation","Widebody & Rotor Avionics"]',   DATE_SUB(NOW(), INTERVAL 3 HOUR)),
(5, 3, 'daniel.brooks',  'daniel.brooks@smart-demo.local','$2a$10$Mlp3VMrzeZMkCXUNYsBOuOehSA6VJZvQRf/IjW69n3T5SUtYOPzju','Daniel', 'Brooks',  'Motion & Hydraulics',  'Motion & Control Loading Spec.',  '+1-555-0105', TRUE, '["6-DOF Electric Motion","Digital CLS-500","Motion LOTO Level 2"]',         DATE_SUB(NOW(), INTERVAL 4 HOUR)),
(6, 3, 'hannah.patel',   'hannah.patel@smart-demo.local','$2a$10$Mlp3VMrzeZMkCXUNYsBOuOehSA6VJZvQRf/IjW69n3T5SUtYOPzju', 'Hannah', 'Patel',   'Spares & Shift Ops',   'Shift Engineer & Spares Coord.',  '+1-555-0106', TRUE, '["Aviation Spares / RMA","FlexIOS v8 Admin","TPS Pre-Flight Lead"]',        DATE_SUB(NOW(), INTERVAL 50 MINUTE)),
(7, 3, 'ryan.foster',    'ryan.foster@smart-demo.local', '$2a$10$Mlp3VMrzeZMkCXUNYsBOuOehSA6VJZvQRf/IjW69n3T5SUtYOPzju', 'Ryan',   'Foster',  'Tactical & Rotorcraft','Tactical & Rotorcraft FSTD Eng.', '+1-555-0107', TRUE, '["AJT-50 FMS Tactical","H145 NVG/HEMS","LVC Network Admin"]',               DATE_SUB(NOW(), INTERVAL 5 HOUR)),
(8, 4, 'olivia.grant',   'olivia.grant@smart-demo.local','$2a$10$Mlp3VMrzeZMkCXUNYsBOuOehSA6VJZvQRf/IjW69n3T5SUtYOPzju', 'Olivia', 'Grant',   'Quality & Compliance', 'Aviation Quality & Safety Auditor','+1-555-0108', TRUE, '["EASA / FAA FSTD Auditor","ISO 9001 Lead Auditor"]',                       DATE_SUB(NOW(), INTERVAL 1 DAY));

-- =============================================================================
-- 3. FLIGHT SIMULATORS FLEET (6 FFS Bays + 6 Test Places + 6 IOS Consoles)
-- =============================================================================
INSERT INTO simulators
  (id, code, name, bay_code, station_kind, sort_order, platform_category, aircraft_type, manufacturer, serial_number, authority, qualification_level, certificate_code, certificate_expiry, last_eval_date, daily_available_hours, engine_avionics, software_load, airac_cycle, visual_system, motion_system, control_loading, ios_config, status, power_on_hours, motion_hours, visual_lamp_hours, limitations_mel, notes)
VALUES
-- 6 Full Flight Simulators (FFS_BAY)
(1, 'FFS-A320-01', 'Airbus A320neo Full Flight Simulator #1',  'BAY-01', 'FFS_BAY', 1, 'COMMERCIAL_FIXED_WING', 'Airbus A320neo / CEO',        'AeroSim Pro-7000', 'AS7K-A320-104', 'EASA / FAA',    'CS-FSTD Level D',    'FSTD.INT.014', DATE_ADD(CURDATE(), INTERVAL 185 DAY), DATE_SUB(CURDATE(), INTERVAL 180 DAY), 20.0, 'CFM LEAP-1A26 / Digital FMS R2',         'Host Load v4.18.2', 'AIRAC 2611', 'OptiDome 6000 · 200x40 Laser 3ch',     '6-DOF Electric eDrive Platform',  'Digital CLS-500 Force-Feel', 'Dual-Screen FlexIOS Console v8',  'IN_SORTIE',   18420.5, 14210.0, 3120.4, NULL, 'Primary narrowbody revenue bay. Cat IIIB LVP & UPRT qualified.'),
(2, 'FFS-B737-02', 'Boeing 737 MAX 8 Full Flight Simulator #2','BAY-02', 'FFS_BAY', 2, 'COMMERCIAL_FIXED_WING', 'Boeing 737 MAX 8 / 800',      'AeroSim Pro-7000', 'AS7K-B737-209', 'EASA / FAA',    'CS-FSTD Level D',    'FSTD.INT.022', DATE_ADD(CURDATE(), INTERVAL 18 DAY),  DATE_SUB(CURDATE(), INTERVAL 347 DAY), 20.0, 'CFM LEAP-1B / Integrated Flight Deck',   'Host Load v5.04.1', 'AIRAC 2611', 'LumaDome 6000 · 220x40 LED Array',     '6-DOF Electric eDrive Platform',  'Digital Control Column CLS', 'Mobile Tablet + Desk FlexIOS',    'READY',       15290.0, 11845.5, 2410.0, NULL, 'Annual recurrent regulatory evaluation scheduled in 18 days; QTG pack 96% complete.'),
(3, 'FFS-A350-03', 'Airbus A350-900 Full Flight Simulator #3', 'BAY-03', 'FFS_BAY', 3, 'COMMERCIAL_FIXED_WING', 'Airbus A350-900 XWB',         'AeroSim Pro-7000', 'AS7K-A350-312', 'EASA / FAA',    'Level D Dual-Qual',  'FSTD.INT.035', DATE_ADD(CURDATE(), INTERVAL 260 DAY), DATE_SUB(CURDATE(), INTERVAL 105 DAY), 20.0, 'Trent XWB-84 / 6-Display Glass Suite',   'Host Load v3.22.0', 'AIRAC 2611', 'OptiDome 6000 · 4K Laser Array',       '6-DOF Hydraulic-Free Electric',   'Active Side-Stick CLS',      'FlexIOS v8 + Debrief Pod',        'DEGRADED',     9840.2,  7610.8, 1890.0, 'MEL CAT B: Visual Ch.3 right peripheral laser dimmed 12%. Day/Night training cleared; LVP Cat III restricted until module swap.', 'Long-haul widebody fleet bay. Inbound replacement laser module ETA +4d.'),
(4, 'FFS-H145-04', 'Airbus H145 Rotorcraft FFS #4',            'BAY-04', 'FFS_BAY', 4, 'ROTORCRAFT',            'Airbus H145 D3',              'HeliSim Pro-3000', 'HS3K-H145-077', 'EASA / FAA',    'CS-FSTD(H) Level D', 'FSTD.H.005',   DATE_ADD(CURDATE(), INTERVAL 140 DAY), DATE_SUB(CURDATE(), INTERVAL 225 DAY), 18.0, 'Safran Arriel 2E / Helionix Step 3',     'RotorHost v6.1.4',  'AIRAC 2611', '8-Channel Extreme FOV Chin-Window Dome','6-DOF High-Frequency Rotor Drive','4-Axis Helicopter AFCS CLS', 'HEMS / SAR Mission FlexIOS',      'READY',       11340.0,  9450.0, 2105.5, NULL, 'Offshore Oil&Gas, HEMS & NVG Level D certified.'),
(5, 'FMS-AJT-05',  'AJT-50 Advanced Jet Trainer FMS #5',       'BAY-05', 'FFS_BAY', 5, 'DEFENSE_FMS',           'AJT-50 Advanced Jet Trainer', 'TacSim FMS-500',   'TF5-AJT-019',   'ICAO / STANAG', 'Level D Tactical',   'FMS.TAC.005',  DATE_ADD(CURDATE(), INTERVAL 210 DAY), DATE_SUB(CURDATE(), INTERVAL 155 DAY), 16.0, 'F404-GE-102 / Embedded Tactical Suite',  'TacCore v7.3.0',    'Tactical DB 26-B', '360° Partial Dome 9ch LCoS',     'Fixed-Base G-Seat + G-Suit',      'Fighter HOTAS Force-Feel',   'LVC Tactical White-Force IOS',    'IN_SORTIE',    7620.0,     0.0, 1480.0, NULL, 'LVC networked for multi-ship BFM/ACM & EW tactical sorties.'),
(6, 'FFS-B787-06', 'Boeing 787-9 Dreamliner FFS #6',           'BAY-06', 'FFS_BAY', 6, 'COMMERCIAL_FIXED_WING', 'Boeing 787-9 Dreamliner',     'AeroSim Pro-7000', 'AS7K-B787-402', 'EASA / FAA',    'CS-FSTD Level D',    'FSTD.INT.031', DATE_ADD(CURDATE(), INTERVAL 310 DAY), DATE_SUB(CURDATE(), INTERVAL 55 DAY),  20.0, 'GEnx-1B74 / Common Core Avionics',       'Host Load v4.11.0', 'AIRAC 2611', 'OptiDome 6000 · 4K Laser 3ch',         '6-DOF Electric eDrive Platform',  'Dual-HUD + Digital CLS',     'FlexIOS v8.4 Instructor Station', 'MAINTENANCE',  6450.0,  5120.5, 1120.0, 'Bay offline under LOTO #412 for Actuator #4 servo drive replacement and pitch QTG re-test.', 'Scheduled return-to-service tonight after QTG 3.A.2 verification.'),

-- 6 Test Places (TEST_PLACE)
(7,  'TP-01', 'TEST PLACE 1', 'TP-01', 'TEST_PLACE', 1, 'FTD_FNPT', 'Multi-Role Sim Test Place', 'AeroSim Systems', 'AS-TPS-001', 'EASA / FAA', 'FSTD / TPS', 'TPS-STD-01', DATE_ADD(CURDATE(), INTERVAL 300 DAY), DATE_SUB(CURDATE(), INTERVAL 65 DAY), 16.0, 'Digital Flight Deck Sim Rack', 'TPS Load v5.4', 'AIRAC 2611', 'Collimated 3-Ch LED', 'Fixed-Base TPS', 'Control Loading Bench', 'Dual-Screen FlexIOS v8', 'READY',    3420.0, 0.0, 980.0, NULL, 'Primary avionics & FMS software integration Test Place.'),
(8,  'TP-02', 'TEST PLACE 2', 'TP-02', 'TEST_PLACE', 2, 'FTD_FNPT', 'Multi-Role Sim Test Place', 'AeroSim Systems', 'AS-TPS-002', 'EASA / FAA', 'FSTD / TPS', 'TPS-STD-02', DATE_ADD(CURDATE(), INTERVAL 300 DAY), DATE_SUB(CURDATE(), INTERVAL 65 DAY), 16.0, 'Digital Flight Deck Sim Rack', 'TPS Load v5.4', 'AIRAC 2611', 'Collimated 3-Ch LED', 'Fixed-Base TPS', 'Control Loading Bench', 'Dual-Screen FlexIOS v8', 'READY',    3180.0, 0.0, 910.0, NULL, 'A320 / B737 avionics regression bench.'),
(9,  'TP-03', 'TEST PLACE 3', 'TP-03', 'TEST_PLACE', 3, 'FTD_FNPT', 'Multi-Role Sim Test Place', 'AeroSim Systems', 'AS-TPS-003', 'EASA / FAA', 'FSTD / TPS', 'TPS-STD-03', DATE_ADD(CURDATE(), INTERVAL 300 DAY), DATE_SUB(CURDATE(), INTERVAL 65 DAY), 16.0, 'Digital Flight Deck Sim Rack', 'TPS Load v5.4', 'AIRAC 2611', 'Collimated 3-Ch LED', 'Fixed-Base TPS', 'Control Loading Bench', 'Dual-Screen FlexIOS v8', 'READY',    2940.0, 0.0, 845.0, NULL, 'Visual database & terrain validation station.'),
(10, 'TP-04', 'TEST PLACE 4', 'TP-04', 'TEST_PLACE', 4, 'FTD_FNPT', 'Multi-Role Sim Test Place', 'AeroSim Systems', 'AS-TPS-004', 'EASA / FAA', 'FSTD / TPS', 'TPS-STD-04', DATE_ADD(CURDATE(), INTERVAL 300 DAY), DATE_SUB(CURDATE(), INTERVAL 65 DAY), 16.0, 'Digital Flight Deck Sim Rack', 'TPS Load v5.4', 'AIRAC 2611', 'Collimated 3-Ch LED', 'Fixed-Base TPS', 'Control Loading Bench', 'Dual-Screen FlexIOS v8', 'READY',    3610.0, 0.0, 1020.0, NULL, 'Widebody & rotorcraft multi-role test place.'),
(11, 'TP-05', 'TEST PLACE 5', 'TP-05', 'TEST_PLACE', 5, 'FTD_FNPT', 'Multi-Role Sim Test Place', 'AeroSim Systems', 'AS-TPS-005', 'EASA / FAA', 'FSTD / TPS', 'TPS-STD-05', DATE_ADD(CURDATE(), INTERVAL 300 DAY), DATE_SUB(CURDATE(), INTERVAL 65 DAY), 16.0, 'Digital Flight Deck Sim Rack', 'TPS Load v5.4', 'AIRAC 2611', 'Collimated 3-Ch LED', 'Fixed-Base TPS', 'Control Loading Bench', 'Dual-Screen FlexIOS v8', 'DEGRADED', 3290.0, 0.0, 940.0, 'GPU channel #2 froze during morning pre-flight; under troubleshooting.', 'Active corrective work order open on visual rack GPU.'),
(12, 'TP-06', 'TEST PLACE 6', 'TP-06', 'TEST_PLACE', 6, 'FTD_FNPT', 'Multi-Role Sim Test Place', 'AeroSim Systems', 'AS-TPS-006', 'EASA / FAA', 'FSTD / TPS', 'TPS-STD-06', DATE_ADD(CURDATE(), INTERVAL 300 DAY), DATE_SUB(CURDATE(), INTERVAL 65 DAY), 16.0, 'Digital Flight Deck Sim Rack', 'TPS Load v5.4', 'AIRAC 2611', 'Collimated 3-Ch LED', 'Fixed-Base TPS', 'Control Loading Bench', 'Dual-Screen FlexIOS v8', 'READY',    2750.0, 0.0, 790.0, NULL, 'Reserve acceptance & instructor checkout station.'),

-- 6 IOS Consoles (IOS_CONSOLE)
(13, 'IOS-01', 'IOS CONSOLE 1', 'IOS-01', 'IOS_CONSOLE', 1, 'FTD_FNPT', 'Instructor Operating Console', 'AeroSim Systems', 'AS-IOS-101', 'EASA / FAA', 'IOS Station', 'IOS-STD-01', DATE_ADD(CURDATE(), INTERVAL 330 DAY), DATE_SUB(CURDATE(), INTERVAL 35 DAY), 16.0, 'FlexIOS Host Telemetry', 'IOS v8.4', 'AIRAC 2611', 'Dual 27-in Touch Displays', 'Fixed Console', 'Instructor Desk', 'Primary IOS Console #1', 'READY',    2840.0, 0.0, 0.0, NULL, 'Paired with BAY-01 / TP-01 scenario debrief.'),
(14, 'IOS-02', 'IOS CONSOLE 2', 'IOS-02', 'IOS_CONSOLE', 2, 'FTD_FNPT', 'Instructor Operating Console', 'AeroSim Systems', 'AS-IOS-102', 'EASA / FAA', 'IOS Station', 'IOS-STD-02', DATE_ADD(CURDATE(), INTERVAL 330 DAY), DATE_SUB(CURDATE(), INTERVAL 35 DAY), 16.0, 'FlexIOS Host Telemetry', 'IOS v8.4', 'AIRAC 2611', 'Dual 27-in Touch Displays', 'Fixed Console', 'Instructor Desk', 'Primary IOS Console #2', 'READY',    2690.0, 0.0, 0.0, NULL, 'Paired with BAY-02 / TP-02 scenario debrief.'),
(15, 'IOS-03', 'IOS CONSOLE 3', 'IOS-03', 'IOS_CONSOLE', 3, 'FTD_FNPT', 'Instructor Operating Console', 'AeroSim Systems', 'AS-IOS-103', 'EASA / FAA', 'IOS Station', 'IOS-STD-03', DATE_ADD(CURDATE(), INTERVAL 330 DAY), DATE_SUB(CURDATE(), INTERVAL 35 DAY), 16.0, 'FlexIOS Host Telemetry', 'IOS v8.4', 'AIRAC 2611', 'Dual 27-in Touch Displays', 'Fixed Console', 'Instructor Desk', 'Primary IOS Console #3', 'READY',    2510.0, 0.0, 0.0, NULL, 'Paired with BAY-03 / TP-03 scenario debrief.'),
(16, 'IOS-04', 'IOS CONSOLE 4', 'IOS-04', 'IOS_CONSOLE', 4, 'FTD_FNPT', 'Instructor Operating Console', 'AeroSim Systems', 'AS-IOS-104', 'EASA / FAA', 'IOS Station', 'IOS-STD-04', DATE_ADD(CURDATE(), INTERVAL 330 DAY), DATE_SUB(CURDATE(), INTERVAL 35 DAY), 16.0, 'FlexIOS Host Telemetry', 'IOS v8.4', 'AIRAC 2611', 'Dual 27-in Touch Displays', 'Fixed Console', 'Instructor Desk', 'Primary IOS Console #4', 'DEGRADED', 2920.0, 0.0, 0.0, 'Right intercom PTT audio matrix crackle on Ch.2 (MEL Cat C).', 'Audio card swap planned in afternoon window.'),
(17, 'IOS-05', 'IOS CONSOLE 5', 'IOS-05', 'IOS_CONSOLE', 5, 'FTD_FNPT', 'Instructor Operating Console', 'AeroSim Systems', 'AS-IOS-105', 'EASA / FAA', 'IOS Station', 'IOS-STD-05', DATE_ADD(CURDATE(), INTERVAL 330 DAY), DATE_SUB(CURDATE(), INTERVAL 35 DAY), 16.0, 'FlexIOS Host Telemetry', 'IOS v8.4', 'AIRAC 2611', 'Dual 27-in Touch Displays', 'Fixed Console', 'Instructor Desk', 'Primary IOS Console #5', 'READY',    2380.0, 0.0, 0.0, NULL, 'LVC tactical white-force debrief station.'),
(18, 'IOS-06', 'IOS CONSOLE 6', 'IOS-06', 'IOS_CONSOLE', 6, 'FTD_FNPT', 'Instructor Operating Console', 'AeroSim Systems', 'AS-IOS-106', 'EASA / FAA', 'IOS Station', 'IOS-STD-06', DATE_ADD(CURDATE(), INTERVAL 330 DAY), DATE_SUB(CURDATE(), INTERVAL 35 DAY), 16.0, 'FlexIOS Host Telemetry', 'IOS v8.4', 'AIRAC 2611', 'Dual 27-in Touch Displays', 'Fixed Console', 'Instructor Desk', 'Primary IOS Console #6', 'READY',    2190.0, 0.0, 0.0, NULL, 'Reserve instructor console & QTG recording desk.');

-- =============================================================================
-- 4. SIMULATOR SUBSYSTEMS (48 rows: 8 subsystems x 6 FFS Bays)
-- =============================================================================
INSERT INTO simulator_subsystems
  (simulator_id, subsystem_code, name, part_number, serial_number, firmware_version, status, operating_hours, last_calibrated_at, next_calibration_due, notes)
VALUES
-- BAY-01 (FFS-A320-01)
(1, 'VISUAL',           'OptiDome 6000 3-Ch Laser Projection', 'OPT-VIS-6000L', 'SN-V101', 'VIS-8.4.2', 'NOMINAL', 3120.4, DATE_SUB(CURDATE(), INTERVAL 25 DAY), DATE_ADD(CURDATE(), INTERVAL 65 DAY),  'Luminance 14.2 fL uniform across dome.'),
(1, 'MOTION',           '6-DOF Electric eDrive Platform',      'MOT-ED6-600',   'SN-M101', 'MOT-4.2.1', 'NOMINAL', 14210.0,DATE_SUB(CURDATE(), INTERVAL 40 DAY), DATE_ADD(CURDATE(), INTERVAL 50 DAY),  'Latency 22ms nominal.'),
(1, 'CONTROL_LOADING',  'Digital CLS-500 Force-Feel System',   'CLS-500-STD',   'SN-C101', 'CLS-5.1.3', 'NOMINAL', 16100.0,DATE_SUB(CURDATE(), INTERVAL 30 DAY), DATE_ADD(CURDATE(), INTERVAL 60 DAY),  'Sidestick force curves verified.'),
(1, 'AVIONICS_COCKPIT', 'Digital FMS R2 & Flight Deck Panels', 'AV-FMS-R2',     'SN-A101', 'AV-11.0.4', 'NOMINAL', 18420.5,DATE_SUB(CURDATE(), INTERVAL 14 DAY), DATE_ADD(CURDATE(), INTERVAL 76 DAY),  'AIRAC 2611 active.'),
(1, 'IOS',              'Dual-Screen FlexIOS Console v8',      'FLX-IOS-800',   'SN-I101', 'IOS-9.2.1', 'NOMINAL', 18420.5,DATE_SUB(CURDATE(), INTERVAL 20 DAY), DATE_ADD(CURDATE(), INTERVAL 70 DAY),  'Touch calibration OK.'),
(1, 'HOST_COMPUTE',     'Real-Time Simulation Host Rack',      'HST-RT-700',    'SN-H101', 'HOST-6.0.8','NOMINAL', 18420.5,DATE_SUB(CURDATE(), INTERVAL 10 DAY), DATE_ADD(CURDATE(), INTERVAL 80 DAY),  '60Hz frame margin 98.9%.'),
(1, 'SOUND',            '3D Acoustic & Intercom Matrix',       'SND-3D-MTX',    'SN-S101', 'SND-3.4.0', 'NOMINAL', 17900.0,DATE_SUB(CURDATE(), INTERVAL 50 DAY), DATE_ADD(CURDATE(), INTERVAL 40 DAY),  'All headset channels clear.'),
(1, 'HVAC_POWER',       'Bay 400Hz PDU & Precision Chiller',   'PWR-BAY-400',   'SN-P101', 'PWR-2.1.0', 'NOMINAL', 21400.0,DATE_SUB(CURDATE(), INTERVAL 18 DAY), DATE_ADD(CURDATE(), INTERVAL 72 DAY),  'Bay temp 20.5C / 44% RH.'),

-- BAY-02 (FFS-B737-02)
(2, 'VISUAL',           'LumaDome 6000 220x40 LED System',     'OPT-LUM-6000',  'SN-V202', 'VIS-8.3.9', 'NOMINAL', 2410.0, DATE_SUB(CURDATE(), INTERVAL 12 DAY), DATE_ADD(CURDATE(), INTERVAL 78 DAY),  'Edge blend re-verified for annual eval.'),
(2, 'MOTION',           '6-DOF Electric eDrive Platform',      'MOT-ED6-600',   'SN-M202', 'MOT-4.2.1', 'NOMINAL', 11845.5,DATE_SUB(CURDATE(), INTERVAL 15 DAY), DATE_ADD(CURDATE(), INTERVAL 75 DAY),  'Actuator currents balanced.'),
(2, 'CONTROL_LOADING',  'Digital Control Column CLS-500',      'CLS-500-737',   'SN-C202', 'CLS-5.1.3', 'NOMINAL', 13200.0,DATE_SUB(CURDATE(), INTERVAL 15 DAY), DATE_ADD(CURDATE(), INTERVAL 75 DAY),  'Yoke & rudder forces within CS-FSTD.'),
(2, 'AVIONICS_COCKPIT', 'Integrated Flight Deck & MCP Suite',  'AV-IFD-737',    'SN-A202', 'AV-10.8.2', 'NOMINAL', 15290.0,DATE_SUB(CURDATE(), INTERVAL 14 DAY), DATE_ADD(CURDATE(), INTERVAL 76 DAY),  'AIRAC 2611 active.'),
(2, 'IOS',              'Mobile Tablet + Desk FlexIOS v8',     'FLX-IOS-802',   'SN-I202', 'IOS-9.2.1', 'NOMINAL', 15290.0,DATE_SUB(CURDATE(), INTERVAL 22 DAY), DATE_ADD(CURDATE(), INTERVAL 68 DAY),  'Wi-Fi tablet sync nominal.'),
(2, 'HOST_COMPUTE',     'Real-Time Simulation Host Rack',      'HST-RT-700',    'SN-H202', 'HOST-6.0.8','NOMINAL', 15290.0,DATE_SUB(CURDATE(), INTERVAL 9 DAY),  DATE_ADD(CURDATE(), INTERVAL 81 DAY),  'Zero frame overruns.'),
(2, 'SOUND',            '3D Acoustic & GPWS Audio Engine',     'SND-3D-MTX',    'SN-S202', 'SND-3.4.0', 'NOMINAL', 14900.0,DATE_SUB(CURDATE(), INTERVAL 40 DAY), DATE_ADD(CURDATE(), INTERVAL 50 DAY),  'Nominal.'),
(2, 'HVAC_POWER',       'Bay PDU & UPS Conditioning Unit',     'PWR-BAY-400',   'SN-P202', 'PWR-2.1.0', 'NOMINAL', 19100.0,DATE_SUB(CURDATE(), INTERVAL 20 DAY), DATE_ADD(CURDATE(), INTERVAL 70 DAY),  'Nominal.'),

-- BAY-03 (FFS-A350-03 — VISUAL DEGRADED on MEL Cat B)
(3, 'VISUAL',           'OptiDome 6000 4K Laser Array',        'OPT-VIS-4KL',   'SN-V303', 'VIS-8.5.0', 'DEGRADED',1890.0, DATE_SUB(CURDATE(), INTERVAL 62 DAY), DATE_ADD(CURDATE(), INTERVAL 4 DAY),   'Ch.3 peripheral laser module at 88% output; MEL Cat B active.'),
(3, 'MOTION',           '6-DOF Hydraulic-Free Electric Drive', 'MOT-ED6-650',   'SN-M303', 'MOT-4.3.0', 'NOMINAL', 7610.8, DATE_SUB(CURDATE(), INTERVAL 28 DAY), DATE_ADD(CURDATE(), INTERVAL 62 DAY),  'Nominal.'),
(3, 'CONTROL_LOADING',  'Active Side-Stick Control Loading',   'CLS-AS-350',    'SN-C303', 'CLS-5.2.0', 'NOMINAL', 8400.0, DATE_SUB(CURDATE(), INTERVAL 35 DAY), DATE_ADD(CURDATE(), INTERVAL 55 DAY),  'Nominal.'),
(3, 'AVIONICS_COCKPIT', '6-Display Widebody Glass Flight Deck','AV-WB-350DU',   'SN-A303', 'AV-12.1.0', 'NOMINAL', 9840.2, DATE_SUB(CURDATE(), INTERVAL 14 DAY), DATE_ADD(CURDATE(), INTERVAL 76 DAY),  'AIRAC 2611 loaded.'),
(3, 'IOS',              'FlexIOS v8 + Debrief Pod',            'FLX-IOS-350',   'SN-I303', 'IOS-9.3.0', 'NOMINAL', 9840.2, DATE_SUB(CURDATE(), INTERVAL 18 DAY), DATE_ADD(CURDATE(), INTERVAL 72 DAY),  'Nominal.'),
(3, 'HOST_COMPUTE',     'Widebody Dual-Node Host Cluster',     'HST-RT-800',    'SN-H303', 'HOST-6.1.2','NOMINAL', 9840.2, DATE_SUB(CURDATE(), INTERVAL 12 DAY), DATE_ADD(CURDATE(), INTERVAL 78 DAY),  'Nominal.'),
(3, 'SOUND',            '3D Spatial Audio & Crew Intercom',    'SND-3D-MTX',    'SN-S303', 'SND-3.4.2', 'NOMINAL', 9500.0, DATE_SUB(CURDATE(), INTERVAL 45 DAY), DATE_ADD(CURDATE(), INTERVAL 45 DAY),  'Nominal.'),
(3, 'HVAC_POWER',       'High-Load Widebody Bay Chiller/PDU',  'PWR-BAY-500',   'SN-P303', 'PWR-2.2.0', 'NOMINAL', 12400.0,DATE_SUB(CURDATE(), INTERVAL 20 DAY), DATE_ADD(CURDATE(), INTERVAL 70 DAY),  'Nominal.'),

-- BAY-04 (FFS-H145-04)
(4, 'VISUAL',           '8-Ch Extreme FOV Chin-Window Dome',   'OPT-VIS-HELI',  'SN-V404', 'VIS-8.4.0', 'NOMINAL', 2105.5, DATE_SUB(CURDATE(), INTERVAL 19 DAY), DATE_ADD(CURDATE(), INTERVAL 71 DAY),  'NVG IR spectral filter certified.'),
(4, 'MOTION',           '6-DOF High-Frequency Rotor Motion',   'MOT-ED6-ROT',   'SN-M404', 'MOT-4.4.1', 'NOMINAL', 9450.0, DATE_SUB(CURDATE(), INTERVAL 21 DAY), DATE_ADD(CURDATE(), INTERVAL 69 DAY),  'Main rotor 4P/5P vibration cueing nominal.'),
(4, 'CONTROL_LOADING',  '4-Axis Cyclic/Collective/Pedals CLS', 'CLS-H4-145',    'SN-C404', 'CLS-5.1.8', 'NOMINAL', 10200.0,DATE_SUB(CURDATE(), INTERVAL 24 DAY), DATE_ADD(CURDATE(), INTERVAL 66 DAY),  'AFCS force trim release nominal.'),
(4, 'AVIONICS_COCKPIT', 'Helionix Step 3 Glass Cockpit Suite', 'AV-HLX-145',    'SN-A404', 'AV-8.4.5',  'NOMINAL', 11340.0,DATE_SUB(CURDATE(), INTERVAL 14 DAY), DATE_ADD(CURDATE(), INTERVAL 76 DAY),  'SAR/HEMS nav DB updated.'),
(4, 'IOS',              'HEMS / Offshore Mission FlexIOS',     'FLX-IOS-HELI',  'SN-I404', 'IOS-9.2.1', 'NOMINAL', 11340.0,DATE_SUB(CURDATE(), INTERVAL 26 DAY), DATE_ADD(CURDATE(), INTERVAL 64 DAY),  'Sea-state generator nominal.'),
(4, 'HOST_COMPUTE',     'Rotorcraft Blade-Element Host Rack',  'HST-RT-750',    'SN-H404', 'HOST-6.1.4','NOMINAL', 11340.0,DATE_SUB(CURDATE(), INTERVAL 11 DAY), DATE_ADD(CURDATE(), INTERVAL 79 DAY),  'Nominal.'),
(4, 'SOUND',            'Turbine & Rotor Harmonic Sound',      'SND-3D-ROT',    'SN-S404', 'SND-3.5.0', 'NOMINAL', 11000.0,DATE_SUB(CURDATE(), INTERVAL 35 DAY), DATE_ADD(CURDATE(), INTERVAL 55 DAY),  'Nominal.'),
(4, 'HVAC_POWER',       'Rotor Bay PDU & Chiller Unit',        'PWR-BAY-400',   'SN-P404', 'PWR-2.1.0', 'NOMINAL', 14200.0,DATE_SUB(CURDATE(), INTERVAL 20 DAY), DATE_ADD(CURDATE(), INTERVAL 70 DAY),  'Nominal.'),

-- BAY-05 (FMS-AJT-05)
(5, 'VISUAL',           '360° Partial Dome 9-Ch LCoS Visual',  'OPT-VIS-TAC9',  'SN-V505', 'VIS-9.1.0', 'NOMINAL', 1480.0, DATE_SUB(CURDATE(), INTERVAL 16 DAY), DATE_ADD(CURDATE(), INTERVAL 74 DAY),  '9-channel warp/blend nominal.'),
(5, 'MOTION',           'G-Seat & Anti-G Suit Pneumatic Unit', 'MOT-GSEAT-50',  'SN-M505', 'MOT-3.8.0', 'NOMINAL', 6820.0, DATE_SUB(CURDATE(), INTERVAL 20 DAY), DATE_ADD(CURDATE(), INTERVAL 70 DAY),  'Bladder pressure response <35ms.'),
(5, 'CONTROL_LOADING',  'Fighter HOTAS Force-Feel System',     'CLS-HOTAS-50',  'SN-C505', 'CLS-6.0.2', 'NOMINAL', 7100.0, DATE_SUB(CURDATE(), INTERVAL 22 DAY), DATE_ADD(CURDATE(), INTERVAL 68 DAY),  'Nominal.'),
(5, 'AVIONICS_COCKPIT', 'Embedded Tactical Training Suite',    'AV-TAC-50',     'SN-A505', 'AV-7.3.0',  'NOMINAL', 7620.0, DATE_SUB(CURDATE(), INTERVAL 10 DAY), DATE_ADD(CURDATE(), INTERVAL 80 DAY),  'Tactical DB 26-B loaded.'),
(5, 'IOS',              'LVC White-Force Tactical IOS',        'FLX-IOS-LVC',   'SN-I505', 'IOS-9.4.0', 'NOMINAL', 7620.0, DATE_SUB(CURDATE(), INTERVAL 18 DAY), DATE_ADD(CURDATE(), INTERVAL 72 DAY),  'DIS/HLA gateway nominal.'),
(5, 'HOST_COMPUTE',     'Tactical Simulation & Threat Cluster','HST-RT-TAC',    'SN-H505', 'HOST-7.3.0','NOMINAL', 7620.0, DATE_SUB(CURDATE(), INTERVAL 10 DAY), DATE_ADD(CURDATE(), INTERVAL 80 DAY),  'Nominal.'),
(5, 'SOUND',            'Fighter Helmet Comms & RWR Audio',    'SND-3D-TAC',    'SN-S505', 'SND-3.6.0', 'NOMINAL', 7400.0, DATE_SUB(CURDATE(), INTERVAL 30 DAY), DATE_ADD(CURDATE(), INTERVAL 60 DAY),  'Nominal.'),
(5, 'HVAC_POWER',       'Secure Tactical Bay UPS & Cooling',   'PWR-BAY-TAC',   'SN-P505', 'PWR-2.1.4', 'NOMINAL', 9800.0, DATE_SUB(CURDATE(), INTERVAL 15 DAY), DATE_ADD(CURDATE(), INTERVAL 75 DAY),  'Nominal.'),

-- BAY-06 (FFS-B787-06 — MOTION UNDER MAINTENANCE)
(6, 'VISUAL',           'OptiDome 6000 4K Laser 3-Ch',         'OPT-VIS-4KL',   'SN-V606', 'VIS-8.5.0', 'DEGRADED',1120.0, DATE_SUB(CURDATE(), INTERVAL 55 DAY), DATE_ADD(CURDATE(), INTERVAL 1 DAY),   'Re-alignment scheduled post actuator swap.'),
(6, 'MOTION',           '6-DOF Electric eDrive Platform',      'MOT-ED6-650',   'SN-M606', 'MOT-4.3.0', 'MAINTENANCE',5120.5,DATE_SUB(CURDATE(), INTERVAL 88 DAY), CURDATE(),                              'Actuator #4 servo drive replacement in progress under LOTO #412.'),
(6, 'CONTROL_LOADING',  'Dual-HUD & Digital Yoke CLS',         'CLS-500-787',   'SN-C606', 'CLS-5.2.0', 'NOMINAL', 5800.0, DATE_SUB(CURDATE(), INTERVAL 25 DAY), DATE_ADD(CURDATE(), INTERVAL 65 DAY),  'Nominal.'),
(6, 'AVIONICS_COCKPIT', 'Common Core Avionics & Dual HUDs',    'AV-CCS-787',    'SN-A606', 'AV-11.4.0', 'NOMINAL', 6450.0, DATE_SUB(CURDATE(), INTERVAL 14 DAY), DATE_ADD(CURDATE(), INTERVAL 76 DAY),  'AIRAC 2611 loaded.'),
(6, 'IOS',              'FlexIOS v8.4 Instructor Station',     'FLX-IOS-787',   'SN-I606', 'IOS-9.3.1', 'NOMINAL', 6450.0, DATE_SUB(CURDATE(), INTERVAL 20 DAY), DATE_ADD(CURDATE(), INTERVAL 70 DAY),  'Nominal.'),
(6, 'HOST_COMPUTE',     'Real-Time Simulation Host Rack',      'HST-RT-800',    'SN-H606', 'HOST-6.1.0','NOMINAL', 6450.0, DATE_SUB(CURDATE(), INTERVAL 12 DAY), DATE_ADD(CURDATE(), INTERVAL 78 DAY),  'Nominal.'),
(6, 'SOUND',            '3D Acoustic & Intercom Suite',        'SND-3D-MTX',    'SN-S606', 'SND-3.4.2', 'NOMINAL', 6300.0, DATE_SUB(CURDATE(), INTERVAL 40 DAY), DATE_ADD(CURDATE(), INTERVAL 50 DAY),  'Nominal.'),
(6, 'HVAC_POWER',       'Bay 400Hz PDU & Precision Chiller',   'PWR-BAY-500',   'SN-P606', 'PWR-2.2.0', 'NOMINAL', 8200.0, DATE_SUB(CURDATE(), INTERVAL 15 DAY), DATE_ADD(CURDATE(), INTERVAL 75 DAY),  'LOTO tag #412 applied on Motion breaker.');

-- =============================================================================
-- 5. QTG COMPLIANCE RECORDS (24 tests across Q1-Q4 current year)
-- =============================================================================
INSERT INTO simulator_qtg_records
  (simulator_id, test_code, title, category, quarter, year, mode, status, due_date, executed_at, executed_by, measured_delta, notes)
VALUES
-- FFS-A320-01
(1, 'QTG-1.B.1', 'Takeoff Ground Acceleration & V1 Engine Cut',    'PERFORMANCE',   'Q1', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-03-31'), DATE_SUB(NOW(), INTERVAL 210 DAY), 3, '+0.6 kt / +0.9%',       'Well within Level D tolerance.'),
(1, 'QTG-2.C.4', 'Roll Rate & Dutch Roll Damping Response',        'HANDLING',      'Q2', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-06-30'), DATE_SUB(NOW(), INTERVAL 120 DAY), 3, 'Delta 0.04s',           'Passed on first automated pass.'),
(1, 'QTG-3.A.2', '6-DOF Latency & Pitch Cueing Phase Check',       'MOTION_CUEING', 'Q3', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-09-30'), DATE_SUB(NOW(), INTERVAL 45 DAY),  5, '22ms (limit 40ms)',     'Electric motion phase response optimal.'),
(1, 'QTG-4.D.1', 'Optical Collimation, Contrast & Edge Blending',  'VISUAL_SYSTEM', 'Q4', YEAR(CURDATE()), 'MANUAL', 'PASSED',         DATE_ADD(CURDATE(), INTERVAL 15 DAY), DATE_SUB(NOW(), INTERVAL 6 DAY), 4, '14.2 fL / <0.5 arcmin', 'Signed off ahead of schedule.'),
-- FFS-B737-02
(2, 'QTG-1.B.1', 'Takeoff Ground Acceleration & V1 Engine Cut',    'PERFORMANCE',   'Q1', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-03-31'), DATE_SUB(NOW(), INTERVAL 205 DAY), 3, '+0.9 kt',               'Nominal.'),
(2, 'QTG-2.C.4', 'Control Column Force vs Deflection Hysteresis',  'HANDLING',      'Q2', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-06-30'), DATE_SUB(NOW(), INTERVAL 115 DAY), 5, '±0.4 daN',              'Nominal.'),
(2, 'QTG-3.A.2', '6-DOF Motion Transport Delay & Washout',         'MOTION_CUEING', 'Q3', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-09-30'), DATE_SUB(NOW(), INTERVAL 35 DAY),  5, '24ms nominal',          'Ready for annual audit.'),
(2, 'QTG-4.D.1', 'Visual Horizon Alignment & Night Luminance',     'VISUAL_SYSTEM', 'Q4', YEAR(CURDATE()), 'MANUAL', 'PENDING',        DATE_ADD(CURDATE(), INTERVAL 10 DAY), NULL, NULL, NULL, 'Scheduled ahead of annual regulatory re-evaluation.'),
-- FFS-A350-03
(3, 'QTG-1.B.1', 'Climb Performance & Single-Engine Driftdown',    'PERFORMANCE',   'Q1', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-03-31'), DATE_SUB(NOW(), INTERVAL 200 DAY), 3, '+0.5%',                 'Nominal.'),
(3, 'QTG-2.C.4', 'Active Side-Stick Roll Authority & Protections', 'HANDLING',      'Q2', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-06-30'), DATE_SUB(NOW(), INTERVAL 110 DAY), 5, 'Within spec',           'Nominal.'),
(3, 'QTG-3.A.2', '6-DOF Latency & Pitch Cueing Phase Check',       'MOTION_CUEING', 'Q3', YEAR(CURDATE()), 'AUTO',   'TOLERANCE_WARN', CONCAT(YEAR(CURDATE()),'-09-30'), DATE_SUB(NOW(), INTERVAL 20 DAY),  5, '37ms (warn >35ms)',     'Monitor servo tuning during next maintenance.'),
(3, 'QTG-4.D.1', 'Visual Channel 3 Peripheral Luminance & Color',  'VISUAL_SYSTEM', 'Q4', YEAR(CURDATE()), 'MANUAL', 'TOLERANCE_WARN', DATE_ADD(CURDATE(), INTERVAL 5 DAY),  DATE_SUB(NOW(), INTERVAL 3 DAY), 4, 'Ch.3 -12% luminance',   'MEL Cat B active; re-run after laser swap.'),
-- FFS-H145-04
(4, 'QTG-1.H.2', 'Hover IGE / OGE Power & Torque Margin',          'PERFORMANCE',   'Q1', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-03-31'), DATE_SUB(NOW(), INTERVAL 198 DAY), 7, '+1.1% TQ',              'CS-FSTD(H) compliant.'),
(4, 'QTG-2.H.5', 'Autorotation Flare & Collective Pitch Response', 'HANDLING',      'Q2', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-06-30'), DATE_SUB(NOW(), INTERVAL 108 DAY), 7, 'Within CS-FSTD(H)',     'Nominal.'),
(4, 'QTG-3.H.1', '4P/5P Rotor Vibration Spectral Cueing Check',    'MOTION_CUEING', 'Q3', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-09-30'), DATE_SUB(NOW(), INTERVAL 32 DAY),  5, '0.03g delta',           'Nominal.'),
(4, 'QTG-4.H.3', 'Chin-Window FOV & NVG Spectral Compatibility',   'VISUAL_SYSTEM', 'Q4', YEAR(CURDATE()), 'MANUAL', 'PENDING',        DATE_ADD(CURDATE(), INTERVAL 18 DAY), NULL, NULL, NULL, 'Planned for next night engineering slot.'),
-- FMS-AJT-05
(5, 'QTG-1.T.1', 'Transonic Acceleration & Energy Maneuverability','PERFORMANCE',   'Q1', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-03-31'), DATE_SUB(NOW(), INTERVAL 190 DAY), 7, '+0.4% Mach',            'STANAG certified.'),
(5, 'QTG-2.T.3', 'High-AoA Roll Coupling & FBW Limiter Test',      'HANDLING',      'Q2', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-06-30'), DATE_SUB(NOW(), INTERVAL 98 DAY),  7, 'Nominal',               'Nominal.'),
(5, 'QTG-5.T.1', 'Cockpit RWR & Engine Acoustic Fidelity',         'SOUND',         'Q3', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-09-30'), DATE_SUB(NOW(), INTERVAL 28 DAY),  7, '±1.2 dB',               'Passed.'),
(5, 'QTG-6.T.2', 'LVC Tactical Datalink & IOS Entity Sync',        'IOS_NAV',       'Q4', YEAR(CURDATE()), 'MANUAL', 'PENDING',        DATE_ADD(CURDATE(), INTERVAL 22 DAY), NULL, NULL, NULL, 'Scheduled with multi-ship test.'),
-- FFS-B787-06
(6, 'QTG-1.B.1', 'Takeoff Performance & Flap Retraction Profile',  'PERFORMANCE',   'Q1', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-03-31'), DATE_SUB(NOW(), INTERVAL 195 DAY), 3, '+0.7 kt',               'Nominal.'),
(6, 'QTG-2.C.4', 'Dual-HUD Conformal Symbology & Roll Rate',       'HANDLING',      'Q2', YEAR(CURDATE()), 'AUTO',   'PASSED',         CONCAT(YEAR(CURDATE()),'-06-30'), DATE_SUB(NOW(), INTERVAL 104 DAY), 4, '<0.8 mrad',             'Nominal.'),
(6, 'QTG-3.A.2', '6-DOF Actuator #4 Pitch Cueing & Latency',       'MOTION_CUEING', 'Q3', YEAR(CURDATE()), 'AUTO',   'FAILED',         DATE_SUB(CURDATE(), INTERVAL 2 DAY),  DATE_SUB(NOW(), INTERVAL 2 DAY), 5, '54ms / Actuator #4 fault', 'Failed due to servo drive fault; WO in progress on BAY-06.'),
(6, 'QTG-4.D.1', 'Optical Collimation & Laser Balance Check',      'VISUAL_SYSTEM', 'Q4', YEAR(CURDATE()), 'MANUAL', 'PENDING',        DATE_ADD(CURDATE(), INTERVAL 12 DAY), NULL, NULL, NULL, 'Queued immediately after motion RTS.');

-- =============================================================================
-- 6. DAILY STATION OPERATIONS — 7 DAYS (TEST PLACES & IOS CONSOLES)
--    Fills Flight Simulators Daily Ops, 24h Bay Timeline & Weekly Reports!
-- =============================================================================
INSERT INTO simulator_daily_logs
  (id, log_date, station_kind, system_readiness_time, post_testing_time, logout_time, general_notes, updated_by)
VALUES
-- TEST_PLACE (7 days: -6d .. today)
(1,  DATE_SUB(CURDATE(), INTERVAL 6 DAY), 'TEST_PLACE',  '06:30', '17:00', '18:00', 'All 6 Test Places nominal across both shifts.', 6),
(2,  DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'TEST_PLACE',  '06:30', '17:00', '18:00', 'AIRAC 2611 database distributed and verified across TP-01..TP-06.', 6),
(3,  DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'TEST_PLACE',  '06:30', '17:00', '18:00', 'High utilization day for A320/B737 software acceptance runs.', 3),
(4,  DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'TEST_PLACE',  '06:30', '17:00', '18:00', 'TP-04 brief SMT freeze cleared via cold reboot; zero lost slots.', 3),
(5,  DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'TEST_PLACE',  '06:30', '17:00', '18:00', 'Routine acceptance testing completed on schedule.', 6),
(6,  DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'TEST_PLACE',  '06:30', '17:00', '18:00', 'TP-05 GPU channel #2 warning logged at 16:40; scheduled for bench check.', 6),
(7,  CURDATE(),                           'TEST_PLACE',  '06:30', '17:00', '18:00', 'TP-01..TP-04 active in Shift 1 & Shift 2. TP-05 isolated NA for GPU swap.', 6),
-- IOS_CONSOLE (7 days: -6d .. today)
(8,  DATE_SUB(CURDATE(), INTERVAL 6 DAY), 'IOS_CONSOLE', '06:30', '17:00', '18:00', 'All 6 IOS Consoles passed morning pre-flight telemetry sync.', 6),
(9,  DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'IOS_CONSOLE', '06:30', '17:00', '18:00', 'IOS v8.4 patch verified on IOS-01..IOS-06.', 4),
(10, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'IOS_CONSOLE', '06:30', '17:00', '18:00', 'Full instructor debrief schedule across commercial bays.', 6),
(11, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'IOS_CONSOLE', '06:30', '17:00', '18:00', 'All consoles nominal.', 6),
(12, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'IOS_CONSOLE', '06:30', '17:00', '18:00', 'LVC white-force debrief ran cleanly on IOS-05.', 7),
(13, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'IOS_CONSOLE', '06:30', '17:00', '18:00', 'Intercom PTT static reported on IOS-04 Ch.2; MEL Cat C opened.', 4),
(14, CURDATE(),                           'IOS_CONSOLE', '06:30', '17:00', '18:00', 'IOS-01..IOS-04 live in morning shift; audio card swap planned for IOS-04.', 6);

INSERT INTO simulator_daily_shifts
  (id, daily_log_id, shift_number, shift_name, pre_flight_test_time, lead_user_id, signed_off_at, signed_off_by)
VALUES
-- Historical TP shifts (signed off)
(1,  1,  1, 'SHIFT 1', '06:40', 6, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '14:05:00'), 6),
(2,  2,  1, 'SHIFT 1', '06:40', 6, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '14:10:00'), 6),
(3,  3,  1, 'SHIFT 1', '06:40', 3, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '14:00:00'), 3),
(4,  4,  1, 'SHIFT 1', '06:40', 3, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '14:15:00'), 3),
(5,  5,  1, 'SHIFT 1', '06:40', 6, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '14:05:00'), 6),
(6,  6,  1, 'SHIFT 1', '06:40', 6, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '14:00:00'), 6),
(7,  6,  2, 'SHIFT 2', '13:30', 4, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '18:10:00'), 4),
-- TODAY TP shifts (SHIFT 1 + SHIFT 2)
(8,  7,  1, 'SHIFT 1', '06:40', 6, NULL, NULL),
(9,  7,  2, 'SHIFT 2', '13:30', 4, NULL, NULL),
-- Historical IOS shifts (signed off)
(10, 8,  1, 'SHIFT 1', '06:45', 6, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '14:05:00'), 6),
(11, 9,  1, 'SHIFT 1', '06:45', 4, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '14:10:00'), 4),
(12, 10, 1, 'SHIFT 1', '06:45', 6, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '14:00:00'), 6),
(13, 11, 1, 'SHIFT 1', '06:45', 6, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '14:05:00'), 6),
(14, 12, 1, 'SHIFT 1', '06:45', 7, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '14:00:00'), 7),
(15, 13, 1, 'SHIFT 1', '06:45', 4, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '14:15:00'), 4),
-- TODAY IOS shifts (SHIFT 1 + SHIFT 2)
(16, 14, 1, 'SHIFT 1', '06:45', 6, NULL, NULL),
(17, 14, 2, 'SHIFT 2', '13:30', 4, NULL, NULL);

-- Shift entries for TEST_PLACE (simulators 7..12)
INSERT INTO simulator_shift_entries
  (shift_id, simulator_id, usage_status, sim_testing_start, sim_testing_end, notes, updated_by)
VALUES
-- Day -6 (shift 1)
(1, 7, 'IN_USE', '07:00', '12:30', 'A320 FMS regression OK', 6),
(1, 8, 'IN_USE', '07:30', '13:00', 'B737 flight model check', 6),
(1, 9, 'IN_USE', '08:00', '12:00', 'Terrain DB validation', 6),
(1, 10,'READY',  '00:00', '00:00', NULL, 6),
(1, 11,'IN_USE', '08:30', '13:00', 'Nominal session', 6),
(1, 12,'READY',  '00:00', '00:00', NULL, 6),
-- Day -5 (shift 2)
(2, 7, 'IN_USE', '07:00', '13:00', 'AIRAC 2611 load verified', 6),
(2, 8, 'IN_USE', '07:00', '12:30', 'AIRAC 2611 load verified', 6),
(2, 9, 'IN_USE', '08:00', '13:30', 'AIRAC 2611 load verified', 6),
(2, 10,'IN_USE', '07:30', '12:00', 'H145 nav verification', 6),
(2, 11,'READY',  '00:00', '00:00', NULL, 6),
(2, 12,'READY',  '00:00', '00:00', NULL, 6),
-- Day -4 (shift 3)
(3, 7, 'IN_USE', '07:00', '13:30', 'Full acceptance suite', 3),
(3, 8, 'IN_USE', '07:00', '13:30', 'Full acceptance suite', 3),
(3, 9, 'IN_USE', '07:30', '12:30', 'Visual terrain check', 3),
(3, 10,'IN_USE', '08:00', '13:00', 'Rotorcraft autopilot test', 3),
(3, 11,'IN_USE', '08:00', '12:00', 'Nominal', 3),
(3, 12,'READY',  '00:00', '00:00', NULL, 3),
-- Day -3 (shift 4)
(4, 7, 'IN_USE', '07:00', '12:30', NULL, 3),
(4, 8, 'IN_USE', '07:30', '13:00', NULL, 3),
(4, 9, 'READY',  '00:00', '00:00', NULL, 3),
(4, 10,'IN_USE', '08:00', '12:30', 'Brief SMT freeze on cold start — restarted OK', 3),
(4, 11,'IN_USE', '07:30', '13:00', NULL, 3),
(4, 12,'READY',  '00:00', '00:00', NULL, 3),
-- Day -2 (shift 5)
(5, 7, 'IN_USE', '07:00', '12:30', NULL, 6),
(5, 8, 'IN_USE', '07:00', '12:30', NULL, 6),
(5, 9, 'IN_USE', '08:00', '13:00', NULL, 6),
(5, 10,'IN_USE', '08:00', '12:00', NULL, 6),
(5, 11,'READY',  '00:00', '00:00', NULL, 6),
(5, 12,'READY',  '00:00', '00:00', NULL, 6),
-- Day -1 (shift 6 morning + shift 7 afternoon)
(6, 7, 'IN_USE', '07:00', '12:30', NULL, 6),
(6, 8, 'IN_USE', '07:00', '13:00', NULL, 6),
(6, 9, 'IN_USE', '08:00', '12:30', NULL, 6),
(6, 10,'IN_USE', '07:30', '12:00', NULL, 6),
(6, 11,'IN_USE', '08:00', '12:00', 'Intermittent frame drop observed at 11:45', 6),
(6, 12,'READY',  '00:00', '00:00', NULL, 6),
(7, 7, 'IN_USE', '13:30', '17:00', NULL, 4),
(7, 8, 'IN_USE', '13:30', '17:00', NULL, 4),
(7, 9, 'READY',  '00:00', '00:00', NULL, 4),
(7, 10,'IN_USE', '14:00', '17:00', NULL, 4),
(7, 11,'NA',     '00:00', '00:00', 'GPU channel #2 froze during reboot — moved to troubleshooting', 4),
(7, 12,'READY',  '00:00', '00:00', NULL, 4),
-- TODAY (shift 8 morning + shift 9 afternoon)
(8, 7, 'IN_USE', '07:00', '12:30', 'A320neo avionics pre-eval run — nominal', 6),
(8, 8, 'IN_USE', '07:00', '12:30', 'B737 MAX flight deck checkout — nominal', 6),
(8, 9, 'IN_USE', '07:30', '12:00', 'EGLL/EDDF visual database verification', 6),
(8, 10,'IN_USE', '08:00', '12:30', 'H145 offshore helideck scenario test', 6),
(8, 11,'NA',     '00:00', '00:00', 'NOT STARTING — GPU CH.2 FAULT, UNDER BENCH REPAIR (WO #4)', 6),
(8, 12,'READY',  '08:00', '12:00', 'Hot standby reserve for customer instructors', 6),
(9, 7, 'IN_USE', '13:30', '17:30', 'Afternoon FMS acceptance batch', 4),
(9, 8, 'IN_USE', '13:30', '17:00', 'Annual QTG prep dry-run', 4),
(9, 9, 'IN_USE', '14:00', '17:30', 'Night LVP scene verification', 4),
(9, 10,'READY',  '13:30', '17:00', 'Ready for customer booking', 4),
(9, 11,'NA',     '00:00', '00:00', 'Awaiting GPU thermal module re-test', 4),
(9, 12,'READY',  '13:30', '17:00', 'Standby reserve', 4),

-- Shift entries for IOS_CONSOLE (simulators 13..18)
(10,13,'IN_USE', '07:00', '12:30', NULL, 6),
(10,14,'IN_USE', '07:00', '12:30', NULL, 6),
(10,15,'IN_USE', '08:00', '12:00', NULL, 6),
(10,16,'IN_USE', '08:00', '12:00', NULL, 6),
(10,17,'READY',  '00:00', '00:00', NULL, 6),
(10,18,'READY',  '00:00', '00:00', NULL, 6),
(11,13,'IN_USE', '07:00', '13:00', 'IOS v8.4 patch verified', 4),
(11,14,'IN_USE', '07:00', '13:00', 'IOS v8.4 patch verified', 4),
(11,15,'IN_USE', '07:30', '12:30', 'IOS v8.4 patch verified', 4),
(11,16,'IN_USE', '08:00', '12:30', 'IOS v8.4 patch verified', 4),
(11,17,'IN_USE', '08:30', '12:00', 'LVC debrief ok', 4),
(11,18,'READY',  '00:00', '00:00', NULL, 4),
(12,13,'IN_USE', '07:00', '13:00', NULL, 6),
(12,14,'IN_USE', '07:00', '12:30', NULL, 6),
(12,15,'IN_USE', '07:30', '13:00', NULL, 6),
(12,16,'READY',  '00:00', '00:00', NULL, 6),
(12,17,'IN_USE', '09:00', '13:00', NULL, 6),
(12,18,'READY',  '00:00', '00:00', NULL, 6),
(13,13,'IN_USE', '07:00', '12:30', NULL, 6),
(13,14,'IN_USE', '07:30', '12:30', NULL, 6),
(13,15,'IN_USE', '08:00', '12:30', NULL, 6),
(13,16,'IN_USE', '08:00', '12:00', NULL, 6),
(13,17,'READY',  '00:00', '00:00', NULL, 6),
(13,18,'READY',  '00:00', '00:00', NULL, 6),
(14,13,'IN_USE', '07:00', '12:30', NULL, 7),
(14,14,'IN_USE', '07:00', '12:30', NULL, 7),
(14,15,'READY',  '00:00', '00:00', NULL, 7),
(14,16,'IN_USE', '08:00', '12:00', NULL, 7),
(14,17,'IN_USE', '08:30', '13:30', 'Multi-ship LVC debrief active', 7),
(14,18,'READY',  '00:00', '00:00', NULL, 7),
(15,13,'IN_USE', '07:00', '12:30', NULL, 4),
(15,14,'IN_USE', '07:00', '12:30', NULL, 4),
(15,15,'IN_USE', '08:00', '12:30', NULL, 4),
(15,16,'IN_USE', '08:00', '11:30', 'Intercom Ch.2 PTT crackle — MEL Cat C opened', 4),
(15,17,'IN_USE', '09:00', '13:00', NULL, 4),
(15,18,'READY',  '00:00', '00:00', NULL, 4),
-- TODAY IOS (shift 16 morning + shift 17 afternoon)
(16,13,'IN_USE', '07:15', '12:30', 'Paired with BAY-01 SkyLine Airways LPC', 6),
(16,14,'IN_USE', '07:15', '12:00', 'Paired with BAY-02 EuroJet Express Type Rating', 6),
(16,15,'IN_USE', '08:00', '12:30', 'Paired with BAY-03 Meridian Global crew brief', 6),
(16,16,'IN_USE', '08:00', '12:00', 'Using primary intercom Ch.1 (MEL Cat C on Ch.2)', 6),
(16,17,'READY',  '08:00', '12:00', 'Ready for AJT-50 debrief', 6),
(16,18,'READY',  '08:00', '12:00', 'Standby reserve', 6),
(17,13,'IN_USE', '13:30', '17:30', 'Afternoon debrief session', 4),
(17,14,'IN_USE', '13:30', '17:30', 'Afternoon debrief session', 4),
(17,15,'READY',  '13:30', '17:30', 'Available', 4),
(17,16,'NA',     '00:00', '00:00', 'Scheduled 14:00 audio routing card swap', 4),
(17,17,'IN_USE', '13:30', '17:00', 'Tactical debrief active', 4),
(17,18,'READY',  '13:30', '17:30', 'Standby reserve', 4);

-- =============================================================================
-- 7. SORTIES & DISPATCH (28 realistic sorties across -25d .. +3d, 6 LIVE TODAY)
-- =============================================================================
INSERT INTO operations
  (id, sortie_code, type_id, simulator_id, created_by, title, customer_operator, scenario_code, weather_profile, motion_required, scheduled_hours, actual_flight_hours, lost_training_minutes, outcome, snag_summary, description, status, priority, location, start_date, end_date, actual_end_date, notes)
VALUES
-- ── TODAY (6 sorties across BAY-01..BAY-05 for live 24h Bay Timeline) ───────
(1,  'SRT-TDY-01', 1, 2, 2, 'B737 MAX 8 Type Rating — Phase 2',            'EuroJet Express',      'EIDW → EGSS',       'Crosswind 28kt / Gusts',    TRUE, 4.00, 4.00, 0,  'CLEAN',                NULL, 'Normal & abnormal procedures, single-engine go-around.',              'COMPLETED',   'MEDIUM',   'BAY-02', TIMESTAMP(CURDATE(), '06:00:00'), TIMESTAMP(CURDATE(), '10:00:00'), TIMESTAMP(CURDATE(), '10:00:00'), 'Zero snags. Crew debriefed on IOS-02.'),
(2,  'SRT-TDY-02', 2, 1, 2, 'A320neo LVP CAT IIIB Recurrent LPC',          'SkyLine Airways',      'EGLL → EDDF',       'Night IMC / RVR 75m',       TRUE, 4.00, NULL, 0,  'PENDING',              NULL, 'Biannual LPC crew proficiency check with dual engine failure.',       'IN_PROGRESS', 'HIGH',     'BAY-01', TIMESTAMP(CURDATE(), '08:00:00'), TIMESTAMP(CURDATE(), '12:00:00'), NULL,                             'Live revenue sortie — BAY-01 nominal.'),
(3,  'SRT-TDY-03', 5, 5, 2, 'AJT-50 2v2 BFM / ACM Tactical LVC Mission',   'Allied Flight Academy','EGOV → Range',      'CAVOK / High Alt',          TRUE, 3.50, NULL, 0,  'PENDING',              NULL, 'Networked LVC tactical intercept & electronic warfare rehearsal.',    'IN_PROGRESS', 'CRITICAL', 'BAY-05', TIMESTAMP(CURDATE(), '09:30:00'), TIMESTAMP(CURDATE(), '13:00:00'), NULL,                             'White-force live on IOS-05.'),
(4,  'SRT-TDY-04', 5, 4, 2, 'H145 Offshore Helideck Night NVG & Hoist',    'NorthSea HEMS',        'ENBR → Rig B',      'Night NVG · Sea State 5',   TRUE, 3.50, NULL, 0,  'PENDING',              NULL, 'Offshore deck landing, OEI fly-away and hoist emergency recovery.',   'PLANNED',     'HIGH',     'BAY-04', TIMESTAMP(CURDATE(), '13:00:00'), TIMESTAMP(CURDATE(), '16:30:00'), NULL,                             'NVG filters verified.'),
(5,  'SRT-TDY-05', 3, 3, 2, 'A350-900 ETOPS Transatlantic LOFT',           'Meridian Global Air',  'EDDF → KJFK',       'North Atlantic Turbulence', TRUE, 4.00, NULL, 0,  'PENDING',              NULL, 'Full LOFT mission; MEL Cat B briefed to instructor (no LVP Cat III).','PLANNED',     'HIGH',     'BAY-03', TIMESTAMP(CURDATE(), '14:00:00'), TIMESTAMP(CURDATE(), '18:00:00'), NULL,                             'Briefed on Visual Ch.3 MEL Cat B.'),
(6,  'SRT-TDY-06', 4, 1, 2, 'A320neo Authority Skill Test / ZFT',          'Nordic Air',           'LFPG → LEMD',       'Low Ceiling / Wind Shear',  TRUE, 4.00, NULL, 0,  'PENDING',              NULL, 'TRE authority skill test and Zero Flight Time qualification.',        'PLANNED',     'HIGH',     'BAY-01', TIMESTAMP(CURDATE(), '18:30:00'), TIMESTAMP(CURDATE(), '22:30:00'), NULL,                             'Examiner confirmed.'),

-- ── PAST 25 DAYS (18 completed/snagged sorties for rich Weekly & Monthly KPIs)
(7,  'SRT-W01-01', 2, 1, 2, 'A320neo Recurrent OPC Crew Alpha',            'SkyLine Airways',      'EHAM → EGLL',       'Fog RVR 125m',              TRUE, 4.00, 4.00, 0,  'CLEAN',                NULL, 'Standard OPC check.',                                                 'COMPLETED',   'MEDIUM',   'BAY-01', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '07:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '11:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '11:00:00'), '100% dispatch reliability.'),
(8,  'SRT-W01-02', 3, 3, 2, 'A350 Long-Haul ETOPS Diversion LOFT',         'Meridian Global Air',  'EDDM → CYYZ',       'Icing / Diversion',         TRUE, 4.00, 3.75, 15, 'COMPLETED_WITH_SNAGS', 'Visual Ch.3 peripheral dimmer noticed in night scene; MEL Cat B logged.', 'Completed with minor 15 min pause for visual check.', 'COMPLETED', 'HIGH', 'BAY-03', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '13:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '17:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '17:15:00'), 'DR opened on Visual Ch.3.'),
(9,  'SRT-W01-03', 1, 2, 2, 'B737 MAX Type Rating — Slot #3',              'EuroJet Express',      'EIDW → LEMD',       'Gusty Crosswind 25kt',      TRUE, 4.00, 4.00, 0,  'CLEAN',                NULL, 'Manual flight & raw data ILS approaches.',                            'COMPLETED',   'MEDIUM',   'BAY-02', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '08:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '12:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '12:00:00'), 'Clean sortie.'),
(10, 'SRT-W01-04', 2, 6, 2, 'B787-9 Recurrent LPC — Crew Charlie',         'TransOceanic Airlines','EGKK → KMIA',       'Thunderstorms / Shear',     TRUE, 4.00, 2.50, 90, 'INTERRUPTED_TECH',     'Motion Actuator #4 servo fault tripped platform to park; bay placed in AOG/MAINT.', 'Sortie aborted at 2.5h; crew rescheduled.', 'COMPLETED', 'CRITICAL', 'BAY-06', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '18:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '16:30:00'), 'WO #1 opened immediately.'),
(11, 'SRT-W01-05', 5, 4, 2, 'H145 Mountain SAR & High-Alt Hover',          'Coastal SAR Ops',      'LOWI → High Ridge', 'Snow / Whiteout',           TRUE, 3.00, 3.00, 0,  'CLEAN',                NULL, 'High-altitude rescue procedures and confined area landing.',          'COMPLETED',   'MEDIUM',   'BAY-04', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '09:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '12:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '12:00:00'), 'Clean.'),
(12, 'SRT-W01-06', 5, 5, 2, 'AJT-50 Air-to-Air Refueling & Radar Ops',     'Allied Flight Academy','EGOV → North Range','Scattered 4000ft',          TRUE, 3.50, 3.50, 0,  'CLEAN',                NULL, 'Formation rejoin and embedded tactical radar modes.',                 'COMPLETED',   'HIGH',     'BAY-05', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '10:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '13:30:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '13:30:00'), 'Clean.'),
(13, 'SRT-W01-07', 6, 1, 3, 'A320neo Q4 Visual & Motion Engineering Fly',  'Internal Engineering', 'EGLL Local',        'Day & Night Calibration',   TRUE, 2.00, 2.00, 0,  'CLEAN',                NULL, 'QTG Q4 validation fly-out by Lead Engineer.',                         'COMPLETED',   'LOW',      'BAY-01', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '08:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '08:00:00'), 'QTG-4.D.1 passed.'),
(14, 'SRT-W02-01', 1, 1, 2, 'A320neo Initial Type Rating — Batch 14',      'Nordic Air',           'EHAM → LSGG',       'Wet Runway / Autobrake',    TRUE, 4.00, 4.00, 0,  'CLEAN',                NULL, 'Rejected takeoff and contaminated runway landings.',                  'COMPLETED',   'MEDIUM',   'BAY-01', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '08:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '12:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '12:00:00'), 'Clean.'),
(15, 'SRT-W02-02', 2, 2, 2, 'B737 MAX Recurrent LPC — Crew Delta',         'EuroJet Express',      'EHAM → EBBR',       'Low Vis CAT II',            TRUE, 4.00, 4.00, 0,  'CLEAN',                NULL, 'Engine failure after V1 and single-channel autopilot approach.',      'COMPLETED',   'MEDIUM',   'BAY-02', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 8 DAY), '14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 8 DAY), '18:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 8 DAY), '18:00:00'), 'Clean.'),
(16, 'SRT-W02-03', 3, 3, 2, 'A350-900 Cabin Smoke & Rapid Descent LOFT',   'Nordic Air',           'LFPG → OMDB',       'Night VMC',                 TRUE, 4.00, 4.00, 0,  'CLEAN',                NULL, 'Emergency descent and diversion coordination.',                       'COMPLETED',   'HIGH',     'BAY-03', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 10 DAY),'09:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 10 DAY),'13:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 10 DAY),'13:00:00'), 'Clean.'),
(17, 'SRT-W02-04', 4, 4, 2, 'H145 Skill Test — Offshore Captain Upgrade',  'NorthSea HEMS',        'ENZV → Rig A',      'Low Cloud / Drizzle',       TRUE, 3.50, 3.50, 0,  'CLEAN',                NULL, 'Command upgrade examiner flight.',                                    'COMPLETED',   'HIGH',     'BAY-04', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 11 DAY),'13:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 11 DAY),'16:30:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 11 DAY),'16:30:00'), 'Clean.'),
(18, 'SRT-W02-05', 1, 6, 2, 'B787-9 Transition Course — Module 6',         'TransOceanic Airlines','EHAM → RJTT',       'Crosswind 30kt',            TRUE, 4.00, 3.85, 10, 'COMPLETED_WITH_SNAGS', 'Brief HUD combiner dimming glitch cleared on reset.',                 'Minor 10 min HUD reset.',                                             'COMPLETED',   'MEDIUM',   'BAY-06', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 12 DAY),'08:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 12 DAY),'12:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 12 DAY),'12:10:00'), 'HUD reset ok.'),
(19, 'SRT-W03-01', 2, 1, 2, 'A320neo UPRT & High-Altitude Stall Recov.',   'SkyLine Airways',      'EGLL → LSZH',       'Severe Turbulence',         TRUE, 4.00, 4.00, 0,  'CLEAN',                NULL, 'UPRT upset prevention and recovery training.',                        'COMPLETED',   'MEDIUM',   'BAY-01', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 15 DAY),'10:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 15 DAY),'14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 15 DAY),'14:00:00'), 'Clean.'),
(20, 'SRT-W03-02', 5, 5, 2, 'AJT-50 Night Close Air Support Rehearsal',    'Allied Flight Academy','EGOV → Range',      'Night NVG',                 TRUE, 3.50, 3.50, 0,  'CLEAN',                NULL, 'Night tactical CAS profile.',                                         'COMPLETED',   'HIGH',     'BAY-05', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 17 DAY),'16:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 17 DAY),'19:30:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 17 DAY),'19:30:00'), 'Clean.'),
(21, 'SRT-W03-03', 1, 2, 2, 'B737 MAX Type Rating — Batch 11',             'EuroJet Express',      'EIDW → LPPT',       'Gusty Coastal Wind',        TRUE, 4.00, 4.00, 0,  'CLEAN',                NULL, 'Normal procedures & RNAV approaches.',                                'COMPLETED',   'MEDIUM',   'BAY-02', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 19 DAY),'07:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 19 DAY),'11:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 19 DAY),'11:00:00'), 'Clean.'),
(22, 'SRT-W04-01', 3, 3, 2, 'A350-900 Polar Route Navigation LOFT',        'Meridian Global Air',  'EDDF → RJAA',       'Solar Storm / Polar',       TRUE, 4.00, 4.00, 0,  'CLEAN',                NULL, 'True-north navigation & fuel freeze procedures.',                     'COMPLETED',   'MEDIUM',   'BAY-03', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 21 DAY),'09:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 21 DAY),'13:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 21 DAY),'13:00:00'), 'Clean.'),
(23, 'SRT-W04-02', 2, 4, 2, 'H145 Annual Instrument Proficiency Check',    'NorthSea HEMS',        'ENBR → ENZV',       'IMC / Freezing Rain',       TRUE, 3.00, 3.00, 0,  'CLEAN',                NULL, 'IFR approaches & AFCS degradation handling.',                         'COMPLETED',   'MEDIUM',   'BAY-04', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 23 DAY),'11:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 23 DAY),'14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 23 DAY),'14:00:00'), 'Clean.'),
(24, 'SRT-W04-03', 4, 6, 2, 'B787-9 Authority Checkride — Crew Bravo',     'TransOceanic Airlines','EGLL → KJFK',       'Night IMC',                 TRUE, 4.00, 4.00, 0,  'CLEAN',                NULL, 'Regulatory examiner checkride.',                                      'COMPLETED',   'HIGH',     'BAY-06', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 25 DAY),'14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 25 DAY),'18:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 25 DAY),'18:00:00'), 'Clean.'),

-- ── UPCOMING 3 DAYS (4 planned sorties) ─────────────────────────────────────
(25, 'SRT-NXT-01', 2, 2, 2, 'B737 MAX Pre-Audit Dry-Run Fly-Out',          'Internal Engineering', 'EDDF Local',        'Full QTG Profile',          TRUE, 3.00, NULL, 0,  'PENDING',              NULL, 'Final engineering readiness verification ahead of annual inspection.', 'PLANNED',     'HIGH',     'BAY-02', TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 1 DAY), '07:00:00'), TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 1 DAY), '10:00:00'), NULL, 'Assigned to David Miller & Claire Bennett.'),
(26, 'SRT-NXT-02', 1, 1, 2, 'A320neo Type Rating — Batch 15 Day 1',        'SkyLine Airways',      'EGLL → EHAM',       'CAVOK / Crosswind',         TRUE, 4.00, NULL, 0,  'PENDING',              NULL, 'Initial handling and flight law transition.',                         'PLANNED',     'MEDIUM',   'BAY-01', TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 1 DAY), '13:00:00'), TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 1 DAY), '17:00:00'), NULL, 'Confirmed.'),
(27, 'SRT-NXT-03', 3, 6, 2, 'B787-9 Post-Maintenance RTS Fly-Out',         'TransOceanic Airlines','EGKK Local',        'Standard RTS Profile',      TRUE, 2.00, NULL, 0,  'PENDING',              NULL, 'Return-to-service motion & visual acceptance sortie.',                'PLANNED',     'HIGH',     'BAY-06', TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 2 DAY), '08:00:00'), TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 2 DAY), '10:00:00'), NULL, 'Pending WO #1 sign-off.'),
(28, 'SRT-NXT-04', 5, 5, 2, 'AJT-50 4-Ship Strike Package LVC',            'Allied Flight Academy','EGOV → Range',      'Dusk / Low Level',          TRUE, 4.00, NULL, 0,  'PENDING',              NULL, 'Four-ship networked tactical mission rehearsal.',                     'PLANNED',     'CRITICAL', 'BAY-05', TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 3 DAY), '14:00:00'), TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 3 DAY), '18:00:00'), NULL, 'LVC gateway reserved.');

INSERT INTO operation_members (operation_id, user_id, role_in_op) VALUES
(1, 3, 'Bay Support Engineer'), (1, 6, 'IOS Coordinator'),
(2, 3, 'Lead Bay Engineer'),    (2, 6, 'Shift Engineer'),
(3, 7, 'Tactical FSTD Engineer'),
(4, 7, 'Rotorcraft Engineer'),  (4, 4, 'NVG Visual Support'),
(5, 4, 'Visual Specialist'),    (5, 2, 'Ops Duty Manager'),
(6, 3, 'Evening Support Engineer'),
(8, 4, 'Visual Diagnostics'),   (10, 5, 'Motion Lead'),
(13, 3, 'QTG Test Lead'),       (25, 3, 'Audit Lead'), (25, 4, 'Visual Lead');

INSERT INTO operation_logs (operation_id, user_id, action, details, logged_at) VALUES
(1,  6, 'PRE_FLIGHT_COMPLETE', 'BAY-02 morning readiness & pre-flight checklist passed at 05:45.',    TIMESTAMP(CURDATE(), '05:45:00')),
(1,  3, 'SORTIE_COMPLETED',    'EuroJet Express Type Rating completed 4.0h with zero technical snags.',TIMESTAMP(CURDATE(), '10:05:00')),
(2,  3, 'SORTIE_STARTED',      'SkyLine Airways crew on deck. BAY-01 motion engaged, LVP scene active.',TIMESTAMP(CURDATE(), '08:02:00')),
(3,  7, 'LVC_LINK_VERIFIED',   'DIS/HLA tactical network verified at 4ms jitter across AJT-50 dome.', TIMESTAMP(CURDATE(), '09:20:00')),
(8,  4, 'SNAG_LOGGED',         'Visual Ch.3 dimmer flagged; DR #2 created with MEL Cat B.',           TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '17:20:00')),
(10, 5, 'TECH_INTERRUPTION',   'Motion Actuator #4 overcurrent trip at 16:30. LOTO #412 applied.',    TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '16:35:00'));

-- =============================================================================
-- 8. FACILITY ASSETS REGISTRY (10 critical center infrastructure assets)
-- =============================================================================
INSERT INTO assets
  (id, category_id, assigned_to, name, serial_number, model, manufacturer, purchase_date, warranty_expiry, location, status, specs, notes)
VALUES
(1,  5, 5, 'Precision Chiller Loop #1 (Bays 1-3)',  'HVAC-CHL-001', 'AquaSnap 30RB-402', 'Carrier',   '2023-03-15', '2028-03-15', 'Plant Mechanical Room',  'ACTIVE',            '{"cooling_kw":400,"glycol_pct":30}',   'Primary simulator bay chilled water loop.'),
(2,  5, 5, 'Precision Chiller Loop #2 (Bays 4-6)',  'HVAC-CHL-002', 'AquaSnap 30RB-402', 'Carrier',   '2023-03-15', '2028-03-15', 'Plant Mechanical Room',  'ACTIVE',            '{"cooling_kw":400,"glycol_pct":30}',   'Redundant loop with automatic failover.'),
(3,  5, 3, '400kVA Rotary UPS Bank A',              'PWR-UPS-400A', 'Galaxy VX 400kVA',  'Schneider', '2022-11-10', '2027-11-10', 'Electrical Substation A','ACTIVE',            '{"kva":400,"autonomy_min":22}',        'Clean 400Hz & bay host backup power.'),
(4,  5, 3, '400kVA Rotary UPS Bank B',              'PWR-UPS-400B', 'Galaxy VX 400kVA',  'Schneider', '2022-11-10', '2027-11-10', 'Electrical Substation B','UNDER_MAINTENANCE', '{"kva":400,"autonomy_min":22}',        'Battery string #3 annual load-bank test scheduled.'),
(5,  3, 1, 'Core Simulation Switch Fabric',         'NET-SW-9500',  'Catalyst 9500-48Y', 'Cisco',     '2024-01-20', '2029-01-20', 'Central Server Room',    'ACTIVE',            '{"ports":"48x25GbE","ptp":"IEEE1588"}','Deterministic low-latency bay backbone.'),
(6,  1, 4, 'Visual Image Generator Master Cluster', 'SRV-IG-001',   'PowerEdge R760xa',  'Dell',      '2024-06-05', '2029-06-05', 'Central Server Room',    'ACTIVE',            '{"gpus":"4x RTX 6000 Ada","ram_gb":512}','Shared visual database compile & backup host.'),
(7,  1, 1, 'SMaRT Telemetry & QTG Archive Server',  'SRV-QTG-002',  'ProLiant DL380 G11','HPE',       '2024-02-12', '2029-02-12', 'Central Server Room',    'ACTIVE',            '{"raid":"RAID-10","storage_tb":48}',   'Stores QTG plots and compliance archives.'),
(8,  4, 1, 'Offsite Replication SAN Array',         'STR-SAN-001',  'FlashArray //X20',  'Pure',      '2023-09-18', '2028-09-18', 'Server Room B',          'ACTIVE',            '{"capacity_tb":88}',                   'Nightly immutable snapshots.'),
(9,  7, 5, 'Bay Hall Fire Suppression & LOTO Panel','SAF-LOTO-001', 'Simplex 4100ES',    'Johnson',   '2022-05-01', '2027-05-01', 'Control Room Entry',     'ACTIVE',            '{"zones":12,"novec1230":true}',        'Centralized emergency stop & LOTO master panel.'),
(10, 2, 6, 'Dispatch Control Room Wall Console',    'WS-CTRL-001',  'Precision 7960',    'Dell',      '2024-04-10', '2029-04-10', 'Ops Control Room',       'ACTIVE',            '{"displays":"3x 4K"}',                 '24/7 sortie dispatch & telemetry wall.');

-- =============================================================================
-- 9. KNOWLEDGE BASE / WIKI SOPs & RUNBOOKS (6 rich Markdown articles)
-- =============================================================================
INSERT INTO wiki_articles
  (id, category_id, author_id, last_editor_id, title, slug, content, excerpt, status, is_pinned, view_count, tags, version, published_at)
VALUES
(1, 3, 5, 5,
 '6-DOF Electric Motion Actuator LOTO & Pre-Work Safety Procedure',
 'ffs-6dof-electric-motion-loto-safety',
 '# 6-DOF Electric Motion Lockout-Tagout (LOTO) Procedure\n\n> Mandatory safety procedure before entering the motion pit or replacing any servo drive / actuator on Level D Full Flight Simulators.\n\n## 1. Pre-Isolation Checks\n- Verify simulator platform is fully **PARKED & RETRACTED** on mechanical stops.\n- Confirm zero personnel inside the motion perimeter gate.\n- Log LOTO tag number in the **Shift Handover Log** and active Work Order.\n\n## 2. Electrical Isolation Steps\n1. Open main bay Motion Circuit Breaker (`QF-MOT-01`) and apply personal padlock + red danger tag.\n2. Wait **5 minutes** for DC bus capacitor discharge (< 50V DC).\n3. Verify zero energy with calibrated CAT IV multimeter at drive cabinet terminals.\n\n```text\nVERIFICATION TARGET: L1-L2 = 0.0V | L2-L3 = 0.0V | DC BUS < 20V\n```\n\n## 3. Return to Service (RTS)\n- Complete **QTG-3.A.2** motion latency & phase test (< 40ms threshold) before releasing bay to revenue sorties.',
 'Mandatory electrical isolation, DC bus discharge verification, and return-to-service QTG checks before servicing 6-DOF electric motion actuators.',
 'PUBLISHED', TRUE, 148, '["LOTO","Safety","Motion","Level-D"]', 3, DATE_SUB(NOW(), INTERVAL 40 DAY)),

(2, 4, 4, 4,
 'OptiDome 6000 4K Laser Projector Optical Alignment & Luminance Calibration',
 'optidome-4k-laser-alignment-sop',
 '# OptiDome 6000 Laser Module Replacement & Calibration\n\n## Scope\nApplies to **BAY-01 (A320neo)**, **BAY-03 (A350-900)**, and **BAY-06 (B787-9)** equipped with 3-channel 4K laser projection arrays.\n\n## Acceptance Criteria (CS-FSTD Level D)\n- Peak white luminance: **12.0 – 15.0 fL** (channel variance < 8%)\n- Geometric warp accuracy: **< 0.5 arcmin** across pilot eyepoint\n- Contrast ratio (night scene): **>= 500:1**\n\n## Replacement Workflow\n1. Inspect spare laser module serial number and confirm `SERVICEABLE` tag in Warehouse.\n2. Replace peripheral channel module wearing ESD strap and clean optical lens.\n3. Run `AutoAlign v8.5` dome camera warp & edge-blend routine.\n4. Measure all 3 channels with calibrated Konica CS-150 photometer and record delta in **QTG-4.D.1**.',
 'Step-by-step laser projector swap, AutoAlign warp/blend procedure, and Level D luminance tolerances.',
 'PUBLISHED', TRUE, 112, '["Visual","OptiDome","Calibration","QTG"]', 2, DATE_SUB(NOW(), INTERVAL 30 DAY)),

(3, 4, 3, 3,
 'Quarterly Level D QTG Automated Validation Runbook',
 'quarterly-level-d-qtg-automated-runbook',
 '# Quarterly Level D QTG Compliance Runbook\n\n## Quarterly Cadence\n- **Q1**: Performance & Takeoff/Climb tests (`QTG-1.x`)\n- **Q2**: Handling Qualities & Control Loading (`QTG-2.x`)\n- **Q3**: 6-DOF Motion Cueing & Transport Delay (`QTG-3.x`)\n- **Q4**: Visual Optical Collimation, Sound & Annual Authority Pack (`QTG-4.x`)\n\n## Execution Checklist\n1. Confirm active `AIRAC` cycle and host software load match the MQTG baseline.\n2. Run automated batch from Host Console; archive PDF plots in `SRV-QTG-002`.\n3. Any test above 90% of tolerance limit must be flagged `TOLERANCE_WARN`; any breach must immediately open a Corrective Work Order (`DR`).',
 'Standard procedure for quarterly automated and manual QTG validation, tolerance escalation, and annual re-evaluation dossier preparation.',
 'PUBLISHED', FALSE, 94, '["QTG","Compliance","Level-D","Runbook"]', 2, DATE_SUB(NOW(), INTERVAL 25 DAY)),

(4, 1, 6, 6,
 'Morning Plant Readiness, Cold Start & Test Place Verification SOP',
 'morning-readiness-test-place-sop',
 '# Morning Plant Readiness (06:30 Local)\n\n## Target Timeline\n- **06:30**: System Readiness — Bay PDUs, Chiller Loops & Host Racks powered.\n- **06:40**: Pre-Flight Test of Test Places (`TP-01..TP-06`) & IOS Consoles (`IOS-01..IOS-06`).\n- **07:00**: First customer sorties and engineering sessions online.\n- **17:00**: Post-Testing routine & daily backup verification.\n- **18:00**: Plant Logout & shift handover sign-off.\n\n## Escalation Rule\nIf any Test Place fails SMT cold-start twice, mark it **NA** in the Daily Shift sheet and trigger **Fault -> WO** immediately.',
 'Daily 06:30–18:00 readiness timeline, Test Place SMT pre-flight rules, and immediate NA escalation protocol.',
 'PUBLISHED', FALSE, 176, '["Daily-Ops","Test-Places","IOS","SOP"]', 4, DATE_SUB(NOW(), INTERVAL 20 DAY)),

(5, 5, 6, 2,
 'AOG Critical Spare Dispatch & Rotable LRU / RMA Return Workflow',
 'aog-spare-dispatch-lru-rma-workflow',
 '# AOG Critical Spares & Rotable LRU Governance\n\n## Priority Dispatch\n1. When an **AOG** snag opens, reserve the required `SERVICEABLE` LRU from `WH-MAIN` or `BAY-STK`.\n2. Log an **OUT** stock movement specifying the target **Simulator Bay** and Work Order reference.\n3. Tag the removed defective unit `IN_REPAIR_RMA`, record the OEM `RMA Reference`, and transfer it to `RMA-BAY`.\n\n## Procurement Trigger\nAny AOG-critical SKU reaching `reorder_point` triggers immediate expedite procurement with ETA tracked in the **Reorder Planner**.',
 'End-to-end spares traceability from bay removal to OEM RMA repair and inbound purchase order receipt.',
 'PUBLISHED', FALSE, 83, '["Warehouse","AOG","LRU","RMA"]', 1, DATE_SUB(NOW(), INTERVAL 15 DAY)),

(6, 2, 2, 8,
 'Minimum Equipment List (MEL) Cat A-D Deferral & Expiry Governance',
 'mel-cat-a-d-deferral-governance',
 '# Simulator MEL Deferral Policy\n\n| MEL Category | Maximum Deferral Window | Approval Required |\n|---|---|---|\n| **CAT A** | Per specific OEM/Authority limit | Compliance Manager |\n| **CAT B** | 3 consecutive calendar days | Head of Ops |\n| **CAT C** | 10 consecutive calendar days | Lead Engineer |\n| **CAT D** | 120 consecutive calendar days | Shift Engineer |\n\n## Mandatory Controls\n- Every deferred snag must record `mel_category` and `mel_expiry_date` on the Work Order.\n- Brief incoming instructors on all operational restrictions before sortie release.',
 'Structured MEL deferral windows, authorization matrix, and mandatory pre-sortie instructor briefing rules.',
 'PUBLISHED', FALSE, 69, '["MEL","Compliance","Governance","DR"]', 1, DATE_SUB(NOW(), INTERVAL 10 DAY));

INSERT INTO wiki_revisions (article_id, editor_id, content, change_note, version) VALUES
(1, 5, 'Initial LOTO procedure draft for 6-DOF electric motion bays.', 'Initial publication', 1),
(1, 5, 'Added 5-minute DC bus capacitor discharge check and QTG-3.A.2 RTS mandate.', 'Safety audit update', 3),
(2, 4, 'Updated OptiDome 6000 luminance targets to 12-15 fL.', 'Added AutoAlign v8.5 steps', 2),
(4, 6, 'Aligned Test Place & IOS pre-flight times to 06:30 / 06:40 standard.', 'Updated shift workflow', 4);

-- =============================================================================
-- 10. WAREHOUSE — AVIATION SPARES, ROTABLE LRUs, RMA & INBOUND POs (14 SKUs)
-- =============================================================================
INSERT INTO inventory_items
  (id, category_id, location_id, sku, part_number, name, description, unit, part_classification, subsystem_code, aog_critical, serial_number, lru_status, installed_simulator_id, rma_reference, on_order_qty, expected_delivery_date, lead_time_days, compatible_models, unserviceable_qty, quantity, min_stock, max_stock, reorder_point, unit_cost, supplier, is_active)
VALUES
-- AOG Critical — OUT OF STOCK with Inbound PO (showcases Urgent Alert + Receive +N!)
(1,  1, 1, 'VIS-LSR-6000', 'OPT-710-4420-01', 'OptiDome 6000 4K Laser Engine Module',     'Primary RGB laser optical engine for 4K widebody projection domes.',   'unit', 'ROTATABLE_LRU',   'VISUAL',          TRUE,  'SN-LSR-2026-041', 'IN_REPAIR_RMA', NULL, 'RMA-OPT-8821',  2, DATE_ADD(CURDATE(), INTERVAL 4 DAY),  14, '["A320neo","A350-900","B787-9"]', 1, 0, 1, 4, 1, 18500.00, 'OptiVision Systems',  TRUE),
-- AOG Critical — LOW STOCK with Inbound PO
(2,  2, 1, 'MOT-SRV-650',  'MOT-E650-DRV',    '6-DOF Electric Actuator Servo Drive',      'High-current electric motion actuator servo amplifier (400V).',        'unit', 'ROTATABLE_LRU',   'MOTION',          TRUE,  'SN-SRV-2025-119', 'SERVICEABLE',   NULL, 'RMA-MOT-4102',  1, DATE_ADD(CURDATE(), INTERVAL 6 DAY),  10, '["A320neo","B737 MAX","A350-900","B787-9"]', 1, 1, 2, 4, 2, 14200.00, 'MotionTech Drives',  TRUE),
-- AOG Critical — LOW STOCK (GPU for Test Place & Visual IG)
(3,  3, 2, 'IG-GPU-6000A', 'NV-RTX6000-ADA',  'Visual IG Workstation GPU RTX 6000 Ada',   '48GB workstation GPU for real-time visual image generators & TPS.',    'unit', 'ROTATABLE_LRU',   'VISUAL',          TRUE,  'SN-GPU-2026-308', 'SERVICEABLE',   NULL, NULL,            2, DATE_ADD(CURDATE(), INTERVAL 3 DAY),   5, '["A320neo","A350-900","TPS-5.4"]', 1, 1, 2, 6, 2, 6800.00,  'ProGraphics OEM',     TRUE),
-- Installed Rotable LRUs on bays (shows Bay Traceability!)
(4,  4, 2, 'CLS-SS-A350',  'CLS-AS350-DUAL',  'Active Side-Stick Control Loading Unit',   'Dual-axis active force-feedback pilot sidestick assembly.',            'unit', 'ROTATABLE_LRU',   'CONTROL_LOADING', TRUE,  'SN-CLS-2024-088', 'INSTALLED',     3,    NULL,            0, NULL,                                 21, '["A350-900"]',                     0, 2, 1, 3, 1, 11400.00, 'ControlSys Dynamics', TRUE),
(5,  3, 2, 'AV-ARINC-429', 'AVB-APX429-16',   'ARINC 429 16-Channel PCIe Interface Card', 'Deterministic avionics bus interface card for host simulation rack.',  'pcs',  'ROTATABLE_LRU',   'AVIONICS_COCKPIT',TRUE,  'SN-A429-2025-512','INSTALLED',     1,    NULL,            0, NULL,                                 14, '["A320neo","B737 MAX","H145"]',    0, 3, 2, 6, 2, 3450.00,  'AvioBus Electronics', TRUE),
-- In Repair RMA LRU (Audio Matrix for IOS-04!)
(6,  3, 3, 'IOS-AUD-MTX',  'FLX-SND-MTX8',    'IOS Digital Intercom & Audio Matrix Card', '8-channel instructor/cockpit audio routing DSP card.',                 'pcs',  'ROTATABLE_LRU',   'SOUND',           FALSE, 'SN-AUD-2025-074', 'IN_REPAIR_RMA', NULL, 'RMA-FLX-8910',  1, DATE_ADD(CURDATE(), INTERVAL 9 DAY),  12, '["IOS-v8","A320neo","B737 MAX"]',  1, 2, 2, 5, 2, 2150.00,  'AeroSpares Global',   TRUE),
-- Healthy AOG Critical Spares
(7,  3, 1, 'PWR-PSU-28V',  'TDK-GEN28-1500',  '28V DC Flight Deck Avionics Power Supply', '1500W rackmount regulated 28V DC cockpit & TPS power supply.',         'unit', 'ROTATABLE_LRU',   'HVAC_POWER',      TRUE,  'SN-PSU-2026-019', 'SERVICEABLE',   NULL, NULL,            0, NULL,                                  7, '["A320neo","B737 MAX","TPS-5.4"]', 0, 5, 2, 8, 2, 1680.00,  'TDK-Lambda',          TRUE),
(8,  2, 1, 'MOT-ENC-ABS',  'HEID-EQN1325',    'Electric Motion Absolute Rotary Encoder',  'High-resolution feedback encoder for 6-DOF actuator legs.',            'pcs',  'ROTATABLE_LRU',   'MOTION',          TRUE,  'SN-ENC-2025-601', 'SERVICEABLE',   NULL, NULL,            0, NULL,                                 10, '["A320neo","B737 MAX","A350-900","B787-9"]', 0, 4, 2, 6, 2, 1290.00, 'Heidenhain',     TRUE),
-- Consumables (1 low stock for Reorder Planner diversity)
(9,  5, 2, 'CON-FLT-VIS',  'OPT-FLT-6000-PK', 'OptiDome Projector HEPA Intake Filter Pack','Dust intake filter pack (box of 6) for OptiDome/LumaDome projectors.','box',  'CONSUMABLE',      'VISUAL',          FALSE, NULL,              'SERVICEABLE',   NULL, NULL,            4, DATE_ADD(CURDATE(), INTERVAL 5 DAY),   4, '["A320neo","A350-900","B787-9"]',  0, 3, 5, 20, 6, 185.00,  'AeroSpares Global',   TRUE),
(10, 5, 1, 'CON-GLY-20L',  'CARR-GLY-30-20L', 'Inhibited Chiller Glycol Fluid (20L Drum)','30% ethylene glycol thermal transfer fluid for bay chiller loops.',    'drum', 'CONSUMABLE',      'HVAC_POWER',      FALSE, NULL,              'SERVICEABLE',   NULL, NULL,            0, NULL,                                  5, '["Facility Chiller"]',             0, 12, 4, 20, 6, 145.00,  'Carrier Service',     TRUE),
(11, 4, 2, 'CON-HD-CUSH',  'TELEX-AIR-CUSH',  'Aviation Headset Ear Cushions & Mic Muffs','Replacement acoustic gel cushions for pilot & instructor headsets.',   'set',  'CONSUMABLE',      'SOUND',           FALSE, NULL,              'SERVICEABLE',   NULL, NULL,            0, NULL,                                  3, '["All Bays","TPS","IOS"]',         0, 24, 8, 40, 10, 38.50,  'Telex Aviation',      TRUE),
(12, 5, 2, 'CON-FUS-400',  'BUSS-NH1-63A',    '400V HRC Ceramic Bay PDU Fuse (63A)',      'High-rupturing-capacity safety fuse for motion & bay PDUs.',           'pcs',  'CONSUMABLE',      'HVAC_POWER',      FALSE, NULL,              'SERVICEABLE',   NULL, NULL,            0, NULL,                                  4, '["All FFS Bays"]',                 0, 18, 6, 30, 8, 24.00,   'Eaton Bussmann',      TRUE),
-- Calibrated Tooling
(13, 6, 4, 'TOL-PHOT-150', 'KM-CS150-CAL',    'Konica Minolta CS-150 Luminance Meter',    'Calibrated spot luminance photometer for Level D QTG visual checks.',  'unit', 'TOOL_CALIBRATED', 'VISUAL',          FALSE, 'SN-KM-2024-882',  'SERVICEABLE',   NULL, NULL,            0, NULL,                                 14, '["All FFS Bays"]',                 0, 2, 1, 2, 1, 4850.00,  'Konica Minolta',      TRUE),
(14, 6, 4, 'TOL-TRQ-SET',  'STAH-730N-KIT',   'Calibrated Precision Torque Wrench Kit',   'ISO 6789 certified torque wrench set (10-200 Nm) for motion mounts.',  'kit',  'TOOL_CALIBRATED', 'MOTION',          FALSE, 'SN-ST-2025-114',  'SERVICEABLE',   NULL, NULL,            0, NULL,                                 10, '["All FFS Bays"]',                 0, 3, 1, 4, 1, 920.00,   'Stahlwille',          TRUE);

-- =============================================================================
-- 11. MAIN SIMULATOR MAINTENANCE — WORK ORDERS, SNAGS (DR) & MEL (18 records)
-- =============================================================================
INSERT INTO maintenance_records
  (id, asset_id, simulator_id, sortie_id, subsystem_code, severity, lost_training_hours, is_snag, performed_by, type, title, description, status, priority, scheduled_date, completed_date, downtime_hours, cost, parts_cost, labor_cost, parts_used, mel_category, mel_expiry_date, wiki_article_id, findings, next_scheduled)
VALUES
-- ── ACTIVE / OPEN SIMULATOR WORK ORDERS & MEL SNAGS ─────────────────────────
(1,  NULL, 6, 10, 'MOTION',       'AOG',      4.50, TRUE,  5, 'CORRECTIVE',
 'DR-2611-01 · B787-9 Actuator #4 Servo Drive Fault & Replacement',
 'Actuator #4 tripped overcurrent protection during TransOceanic LPC sortie. Bay placed in AOG/MAINTENANCE under LOTO #412. Servo amplifier removed and replacement from WH-MAIN installed.',
 'IN_PROGRESS', 'CRITICAL', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '17:00:00'), NULL,
 5.50, 14850.00, 14200.00, 650.00,
 '[{"item_id":2,"sku":"MOT-SRV-650","name":"6-DOF Electric Actuator Servo Drive","quantity":1}]',
 'NONE', NULL, 1,
 'Faulty drive S/N DRV-0918 tagged for RMA-MOT-4102. New drive installed; running final QTG-3.A.2 latency check.',
 TIMESTAMP(CURDATE(), '21:00:00')),

(2,  NULL, 3, 8,  'VISUAL',       'DEGRADED', 0.25, TRUE,  4, 'CORRECTIVE',
 'DR-2611-02 · A350 Visual Ch.3 Peripheral Laser Luminance Drop (-12%)',
 'Right peripheral laser channel dimmed to 88% output during Meridian Global ETOPS LOFT. MEL Cat B applied; LVP Cat III training restricted until inbound OptiDome laser module arrives.',
 'DEFERRED', 'HIGH', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '18:00:00'), NULL,
 1.00, 320.00, 0.00, 320.00,
 '[]',
 'CAT_B', DATE_ADD(CURDATE(), INTERVAL 3 DAY), 2,
 'Photometer confirmed 11.4 fL on Ch.3 vs 14.0 fL on Ch.1/2. Expedited PO inbound ETA +4d.',
 TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 3 DAY), '22:00:00')),

(3,  NULL, 16, NULL, 'SOUND',     'DEGRADED', 0.00, TRUE,  6, 'CORRECTIVE',
 'DR-2611-03 · IOS-04 Intercom Ch.2 PTT Audio Crackle',
 'Instructor reported intermittent static on backup intercom channel 2 during debrief. Primary Ch.1 fully operational. MEL Cat C applied; spare DSP card queued for afternoon swap.',
 'SCHEDULED', 'MEDIUM', TIMESTAMP(CURDATE(), '14:00:00'), NULL,
 1.00, 2350.00, 2150.00, 200.00,
 '[{"item_id":6,"sku":"IOS-AUD-MTX","name":"IOS Digital Intercom & Audio Matrix Card","quantity":1}]',
 'CAT_C', DATE_ADD(CURDATE(), INTERVAL 8 DAY), 5,
 'Spare audio matrix card staged at BAY-STK; scheduled 14:00 window.',
 NULL),

(4,  NULL, 11, NULL, 'VISUAL',    'AOG',      3.00, TRUE,  4, 'CORRECTIVE',
 'DR-2611-04 · TP-05 GPU Channel #2 Freeze on Cold Start',
 'Test Place 5 froze during morning SMT pre-flight verification. Isolated NA; electronics bench replacing GPU RTX 6000 Ada and inspecting thermal paste.',
 'IN_PROGRESS', 'HIGH', TIMESTAMP(CURDATE(), '07:15:00'), NULL,
 3.00, 7120.00, 6800.00, 320.00,
 '[{"item_id":3,"sku":"IG-GPU-6000A","name":"Visual IG Workstation GPU RTX 6000 Ada","quantity":1}]',
 'NONE', NULL, 4,
 'Thermal throttling detected on original GPU card; swapping from BAY-STK.',
 NULL),

-- OVERDUE scheduled inspection (lights up Urgent Alert Center!)
(5,  4,    NULL, NULL, 'HVAC_POWER', 'DEGRADED', 0.00, FALSE, 3, 'INSPECTION',
 'UPS Bank B Battery String #3 Annual Load-Bank Discharge Test',
 'Annual preventive discharge and impedance audit for 400kVA Rotary UPS Bank B.',
 'SCHEDULED', 'HIGH', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '09:00:00'), NULL,
 2.00, 480.00, 0.00, 480.00,
 '[]',
 'NONE', NULL, 1,
 'Delayed due to BAY-06 AOG priority; rescheduled to tonight maintenance window.',
 NULL),

(6,  NULL, 2, NULL, 'VISUAL',     'MINOR',    0.00, FALSE, 4, 'PREVENTIVE',
 'B737 MAX Pre-Audit Optical Collimation & Filter Swap',
 'Full 3-channel LED alignment, contrast check and HEPA filter pack replacement ahead of annual regulatory audit.',
 'SCHEDULED', 'HIGH', TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 2 DAY), '22:00:00'), NULL,
 2.50, 585.00, 185.00, 400.00,
 '[{"item_id":9,"sku":"CON-FLT-VIS","name":"OptiDome Projector HEPA Intake Filter Pack","quantity":1}]',
 'NONE', NULL, 2,
 'Konica CS-150 photometer reserved in CAL-LAB.',
 NULL),

-- ── COMPLETED HISTORICAL WORK ORDERS (for MTTR/MTBF, Costs & MNT Records) ───
(7,  NULL, 1, NULL, 'VISUAL',     'MINOR',    0.00, FALSE, 4, 'PREVENTIVE',
 'A320neo Quarterly OptiDome 6000 Alignment & Filter Replacement',
 'Scheduled Q4 collimation check, edge blend trim, and intake filter replacement.',
 'COMPLETED', 'LOW', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '22:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '23:45:00'),
 1.75, 505.00, 185.00, 320.00,
 '[{"item_id":9,"sku":"CON-FLT-VIS","name":"OptiDome Projector HEPA Intake Filter Pack","quantity":1}]',
 'NONE', NULL, 2,
 'All 3 channels balanced at 14.2 fL; QTG-4.D.1 signed off.',
 TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 84 DAY), '22:00:00')),

(8,  NULL, 1, NULL, 'AVIONICS_COCKPIT', 'DEGRADED', 1.50, TRUE, 3, 'CORRECTIVE',
 'DR-2610-18 · A320neo MCDU #2 ARINC 429 Bus Timeout',
 'Intermittent ARINC 429 parity timeout on First Officer MCDU during pre-flight.',
 'COMPLETED', 'HIGH', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 14 DAY), '06:40:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 14 DAY), '08:15:00'),
 1.50, 3770.00, 3450.00, 320.00,
 '[{"item_id":5,"sku":"AV-ARINC-429","name":"ARINC 429 16-Channel PCIe Interface Card","quantity":1}]',
 'NONE', NULL, 3,
 'Swapped ARINC 429 interface board from BAY-STK; 100% clean bus soak test.',
 NULL),

(9,  NULL, 2, NULL, 'CONTROL_LOADING', 'MINOR', 0.00, FALSE, 5, 'PREVENTIVE',
 'B737 MAX CLS-500 Force-Feel Calibration & Rudder Trim Check',
 'Preventive quarterly control loading force curve verification.',
 'COMPLETED', 'MEDIUM', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 15 DAY), '22:30:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 15 DAY), '23:50:00'),
 1.30, 260.00, 0.00, 260.00,
 '[]',
 'NONE', NULL, 3,
 'All 3 axes within ±0.4 daN of MQTG baseline.',
 TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 75 DAY), '22:30:00')),

(10, NULL, 4, NULL, 'MOTION',     'DEGRADED', 2.00, TRUE,  5, 'CORRECTIVE',
 'DR-2610-11 · H145 Actuator Leg #2 Encoder Drift Alarm',
 'Rotary position feedback drift detected during morning rotor vibration test.',
 'COMPLETED', 'HIGH', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 19 DAY), '06:30:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 19 DAY), '08:45:00'),
 2.25, 1740.00, 1290.00, 450.00,
 '[{"item_id":8,"sku":"MOT-ENC-ABS","name":"Electric Motion Absolute Rotary Encoder","quantity":1}]',
 'NONE', NULL, 1,
 'Replaced Heidenhain encoder; recalibrated stroke zero point and passed QTG-3.H.1.',
 NULL),

(11, NULL, 5, NULL, 'HOST_COMPUTE','MINOR',   0.00, FALSE, 7, 'UPGRADE',
 'AJT-50 TacCore v7.3.0 & Tactical Database 26-B Rollout',
 'Scheduled software load upgrade and LVC multi-ship threat library sync.',
 'COMPLETED', 'MEDIUM', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 12 DAY), '21:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 12 DAY), '23:30:00'),
 2.50, 400.00, 0.00, 400.00,
 '[]',
 'NONE', NULL, 3,
 'Verified 4-ship DIS/HLA packet sync with zero dropouts.',
 NULL),

(12, NULL, 6, 18,   'AVIONICS_COCKPIT','MINOR',0.15, TRUE,  4, 'CORRECTIVE',
 'DR-2610-22 · B787-9 Captain HUD Combiner Auto-Dimming Reset',
 'HUD brightness sensor drifted during night transition module.',
 'COMPLETED', 'MEDIUM', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 12 DAY), '12:15:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 12 DAY), '13:00:00'),
 0.75, 160.00, 0.00, 160.00,
 '[]',
 'NONE', NULL, 2,
 'Recalibrated ambient light sensor firmware; verified across day/dusk/night scenes.',
 NULL),

-- ── TEST PLACE & IOS RAPID MNT RECORDS (Gray Preventive & Red Corrective) ───
(13, NULL, 7, NULL, 'IOS',        'MINOR',    0.00, FALSE, 6, 'PREVENTIVE',
 'TP-01 Quarterly Touchscreen Calibration & AIRAC 2611 Load',
 'Preventive calibration of dual instructor touchscreens and nav database checksum verification.',
 'COMPLETED', 'LOW', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 18 DAY), '17:15:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 18 DAY), '18:00:00'),
 0.75, 120.00, 0.00, 120.00,
 '[]', 'NONE', NULL, 4, 'Calibration delta < 1px. AIRAC 2611 verified.', NULL),

(14, NULL, 10, NULL, 'CONTROL_LOADING','MINOR',0.00, FALSE, 5, 'PREVENTIVE',
 'TP-04 Rudder Pedals Lubrication & Trim Linkage Inspection',
 'Scheduled mechanical preventive lubrication and friction hysteresis verification.',
 'COMPLETED', 'LOW', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 42 DAY), '17:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 42 DAY), '18:00:00'),
 1.00, 150.00, 0.00, 150.00,
 '[]', 'NONE', NULL, 4, 'All pedal travel and centering springs nominal.', NULL),

(15, NULL, 10, NULL, 'HVAC_POWER','AOG',      2.50, TRUE,  3, 'CORRECTIVE',
 'TP-04 Not Starting — New 28V DC Power Supply Unit Installed',
 'Station failed cold power-on self-test at 06:30 due to 28V rail overvoltage protection.',
 'COMPLETED', 'CRITICAL', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 26 DAY), '06:35:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 26 DAY), '09:05:00'),
 2.50, 2080.00, 1680.00, 400.00,
 '[{"item_id":7,"sku":"PWR-PSU-28V","name":"28V DC Flight Deck Avionics Power Supply","quantity":1}]',
 'NONE', NULL, 5, 'Installed new TDK-Lambda 28V PSU from WH-MAIN; 4h burn-in clean.', NULL),

(16, NULL, 10, NULL, 'SOUND',     'MINOR',    0.00, FALSE, 6, 'PREVENTIVE',
 'TP-04 New Headset Ear Cushions & PTT Acoustic Check',
 'Replaced worn pilot/instructor headset ear cushions and tested boom mic PTT.',
 'COMPLETED', 'LOW', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 9 DAY), '17:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 9 DAY), '17:30:00'),
 0.50, 157.00, 77.00, 80.00,
 '[{"item_id":11,"sku":"CON-HD-CUSH","name":"Aviation Headset Ear Cushions & Mic Muffs","quantity":2}]',
 'NONE', NULL, 4, 'Acoustic clarity nominal on both pilot & instructor positions.', NULL),

-- ── FACILITY ASSETS MAINTENANCE RECORDS ─────────────────────────────────────
(17, 1,    NULL, NULL, 'HVAC_POWER','MINOR',  0.00, FALSE, 5, 'PREVENTIVE',
 'Chiller Loop #1 Glycol Top-Up & Flow Balancing',
 'Quarterly thermal loop pressure check and 20L inhibited glycol replenishment.',
 'COMPLETED', 'LOW', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 16 DAY), '06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 16 DAY), '07:30:00'),
 1.50, 385.00, 145.00, 240.00,
 '[{"item_id":10,"sku":"CON-GLY-20L","name":"Inhibited Chiller Glycol Fluid (20L Drum)","quantity":1}]',
 'NONE', NULL, NULL, 'Supply/return delta-T stabilized at 5.2C across Bays 1-3.', NULL),

(18, 5,    NULL, NULL, 'HOST_COMPUTE','MINOR',0.00, FALSE, 1, 'INSPECTION',
 'Core Simulation Switch Fabric Firmware & PTP Precision Clock Audit',
 'Verified IEEE 1588 PTP grandmaster synchronization and redundant uplink failover.',
 'COMPLETED', 'LOW', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 22 DAY), '23:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 22 DAY), '23:45:00'),
 0.75, 140.00, 0.00, 140.00,
 '[]', 'NONE', NULL, NULL, 'PTP jitter < 12 microseconds across all 6 FFS host racks.', NULL);

-- =============================================================================
-- 12. STOCK MOVEMENTS LEDGER (18 movements with Bay & Work Order traceability)
-- =============================================================================
INSERT INTO stock_movements
  (item_id, user_id, simulator_id, maintenance_record_id, type, quantity, quantity_before, quantity_after, reference, reason, destination, movement_date)
VALUES
(1,  6, NULL, NULL, 'IN',         2, 0, 2, 'PO-2026-1102', 'Initial quarterly OptiDome laser stock replenishment',     NULL, DATE_SUB(NOW(), INTERVAL 26 DAY)),
(1,  4, 3,    NULL, 'OUT',        1, 2, 1, 'WO-PREV-301',  'Replaced aging Ch.1 laser module on BAY-03',               'BAY-03', DATE_SUB(NOW(), INTERVAL 18 DAY)),
(1,  4, 6,    NULL, 'OUT',        1, 1, 0, 'WO-PREV-604',  'Emergency laser swap on BAY-06 (stock now 0 — PO placed)', 'BAY-06', DATE_SUB(NOW(), INTERVAL 5 DAY)),
(2,  6, NULL, NULL, 'IN',         2, 0, 2, 'PO-2026-1088', 'MotionTech servo drive safety buffer receipt',             NULL, DATE_SUB(NOW(), INTERVAL 24 DAY)),
(2,  5, 6,    1,    'OUT',        1, 2, 1, 'MAINT-#1',     'Used in maintenance: B787-9 Actuator #4 Servo Drive Fault','BAY-06', DATE_SUB(NOW(), INTERVAL 1 DAY)),
(3,  6, NULL, NULL, 'IN',         2, 0, 2, 'PO-2026-1120', 'Workstation RTX 6000 Ada spares received',                 NULL, DATE_SUB(NOW(), INTERVAL 19 DAY)),
(3,  4, 11,   4,    'OUT',        1, 2, 1, 'MAINT-#4',     'Used in maintenance: TP-05 GPU Channel #2 Freeze',         'TP-05', DATE_SUB(NOW(), INTERVAL 3 HOUR)),
(5,  3, 1,    8,    'OUT',        1, 4, 3, 'MAINT-#8',     'Replaced faulty ARINC 429 card on BAY-01 MCDU #2',         'BAY-01', DATE_SUB(NOW(), INTERVAL 14 DAY)),
(6,  6, 16,   3,    'TRANSFER',   1, 2, 2, 'MOVE-IOS-04',  'Staged serviceable DSP audio card at BAY-STK for IOS-04',  'BAY-STK', DATE_SUB(NOW(), INTERVAL 1 DAY)),
(7,  3, 10,   15,   'OUT',        1, 6, 5, 'MAINT-#15',    'Installed new 28V DC PSU on TP-04 after power failure',    'TP-04', DATE_SUB(NOW(), INTERVAL 26 DAY)),
(8,  5, 4,    10,   'OUT',        1, 5, 4, 'MAINT-#10',    'Replaced Actuator Leg #2 rotary encoder on BAY-04 H145',   'BAY-04', DATE_SUB(NOW(), INTERVAL 19 DAY)),
(9,  6, NULL, NULL, 'IN',         5, 0, 5, 'PO-2026-1145', 'Restocked OptiDome HEPA filter packs',                     NULL, DATE_SUB(NOW(), INTERVAL 20 DAY)),
(9,  4, 1,    7,    'OUT',        1, 5, 4, 'MAINT-#7',     'Quarterly projector filter swap on BAY-01',                'BAY-01', DATE_SUB(NOW(), INTERVAL 6 DAY)),
(9,  4, 3,    NULL, 'OUT',        1, 4, 3, 'PM-VIS-03',    'Preventive filter swap on BAY-03',                         'BAY-03', DATE_SUB(NOW(), INTERVAL 3 DAY)),
(10, 5, NULL, 17,   'OUT',        1, 13,12,'MAINT-#17',    'Glycol top-up on Precision Chiller Loop #1',               'Plant Mechanical Room', DATE_SUB(NOW(), INTERVAL 16 DAY)),
(11, 6, 10,   16,   'OUT',        2, 26,24,'MAINT-#16',    'Replaced pilot & instructor ear cushions on TP-04',        'TP-04', DATE_SUB(NOW(), INTERVAL 9 DAY)),
(12, 3, 6,    NULL, 'RETURN',     2, 16,18,'RET-BAY-06',   'Returned unused 63A HRC spare fuses after BAY-06 test',    'BAY-STK', DATE_SUB(NOW(), INTERVAL 4 DAY)),
(13, 4, NULL, NULL, 'ADJUSTMENT', 2, 2, 2, 'CAL-2026-Q4',  'Annual ISO 17025 calibration audit inventory check OK',    'CAL-LAB', DATE_SUB(NOW(), INTERVAL 11 DAY));

-- =============================================================================
-- 13. STANDALONE PLANNED MAINTENANCE (14 Daily / Weekly / Monthly schedules)
--     Strictly separate recurring preventive checklists & calendar!
-- =============================================================================
INSERT INTO planned_maintenance_tasks
  (id, simulator_id, `system`, subsystem, task, reference, operation_date_start, operation_date_end, repeat_task_type, repeat_task_number, recurrence_end_date, report_template, status, optional, created_by)
VALUES
-- 5 DAILY Preventive Checks (every 1 DAY)
(1,  NULL, 'Plant & Utilities',      'BAY CHILLERS',       'Verify Chiller Loop #1 & #2 supply temp (6.5-8.0C) and bay humidity (40-50% RH)',        'SOP-PM-D01', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 45 DAY), '06:30:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 45 DAY), '06:45:00'), 'DAY',   1, NULL, 'daily-plant-checklist', 'TODO', 0, 3),
(2,  NULL, 'Server Room',            'DEHUMIDIFIER',       'Empty server room dehumidifier external tank and verify datalogger temp < 22C',          'SOP-PM-D02', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 45 DAY), '07:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 45 DAY), '07:15:00'), 'DAY',   1, NULL, 'daily-plant-checklist', 'TODO', 0, 6),
(3,  NULL, 'Simulator Bays — Common','SAFETY & E-STOP',    'Test motion hall perimeter gate interlocks, warning beacons and cockpit E-Stop loop',    'SOP-PM-D03', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 45 DAY), '06:45:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 45 DAY), '07:00:00'), 'DAY',   1, NULL, 'daily-plant-checklist', 'TODO', 0, 5),
(4,  NULL, 'Visual & Optics',        'PROJECTION DOMES',   'Inspect collimated mirror film for dust/condensation and verify projector lamp status',   'SOP-PM-D04', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 45 DAY), '07:15:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 45 DAY), '07:35:00'), 'DAY',   1, NULL, 'daily-plant-checklist', 'TODO', 0, 4),
(5,  NULL, 'IT & Host Racks',        'BACKUP & TELEMETRY', 'Verify nightly QTG archive replication and SMaRT database snapshot integrity',           'SOP-PM-D05', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 45 DAY), '08:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 45 DAY), '08:20:00'), 'DAY',   1, NULL, 'daily-plant-checklist', 'TODO', 0, 1),

-- 5 WEEKLY Preventive Schedules (every 1 or 2 WEEKS)
(6,  NULL, 'Simulator Bays — Common','COCKPIT & AUDIO',    'Sanitize flight decks, test oxygen masks, boom mics and instructor headset PTT switches','SOP-PM-W01', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 42 DAY), '17:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 42 DAY), '18:00:00'), 'WEEK',  1, NULL, 'weekly-bay-audit',      'TODO', 0, 6),
(7,  NULL, 'IT & Host Racks',        'RAID & UPS BATTERY', 'Check RAID controller battery health and execute 400kVA UPS self-test diagnostics',      'SOP-PM-W02', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 41 DAY), '09:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 41 DAY), '09:45:00'), 'WEEK',  1, NULL, 'weekly-it-audit',       'TODO', 0, 1),
(8,  NULL, 'Simulator Bays — Common','IOS & NAVDB',        'Calibrate IOS touchscreens and audit active AIRAC / tactical DB checksums across bays',  'SOP-PM-W03', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 40 DAY), '17:30:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 40 DAY), '18:15:00'), 'WEEK',  1, NULL, 'weekly-bay-audit',      'TODO', 0, 4),
(9,  NULL, 'Motion & Hydraulics',    'CONTROL LOADING',    'Run automated CLS force-feel zero-drift check on primary flight controls (all FFS bays)','SOP-PM-W04', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 39 DAY), '22:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 39 DAY), '23:00:00'), 'WEEK',  1, NULL, 'weekly-motion-audit',   'TODO', 0, 5),
(10, NULL, 'Electrical & LOTO',      'ELECTRICAL PANELS',  'Apply LOTO procedure & infrared thermal scan on Server Room & Bay PDU feeder breakers',  'SOP-LOTO-01',TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 38 DAY), '22:30:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 38 DAY), '23:30:00'), 'WEEK',  2, NULL, 'loto-thermal-report',   'TODO', 1, 3),

-- 4 MONTHLY Preventive Schedules (every 1 MONTH — anchored across the month)
(11, NULL, 'Visual & Optics',        'LASER PROJECTORS',   'Replace/clean HEPA optical intake filters and log photometer luminance across all bays', 'SOP-PM-M01', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 30 DAY), '22:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 30 DAY), '23:30:00'), 'MONTH', 1, NULL, 'monthly-optics-report', 'TODO', 0, 4),
(12, NULL, 'Motion & Hydraulics',    '6-DOF ACTUATORS',    'Lubricate actuator gimbal bearings, inspect encoder harnesses and verify mount torque',  'SOP-PM-M02', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 28 DAY), '22:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 28 DAY), '23:55:00'), 'MONTH', 1, NULL, 'monthly-motion-report', 'TODO', 0, 5),
(13, NULL, 'Plant & Utilities',      'HVAC & GLYCOL LOOP', 'Inspect glycol concentration, bleed air traps and verify chiller failover switchover',   'SOP-PM-M03', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 25 DAY), '06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 25 DAY), '07:30:00'), 'MONTH', 1, NULL, 'monthly-plant-report',  'TODO', 0, 5),
(14, NULL, 'QTG & Compliance',       'REGULATORY ARCHIVE', 'Compile monthly QTG compliance pack, certificate expiry review and MEL closure audit',   'SOP-PM-M04', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 20 DAY), '14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 20 DAY), '16:00:00'), 'MONTH', 1, NULL, 'monthly-qtg-pack',      'TODO', 0, 8);

-- Completed Planned Maintenance Occurrences (so today & recent days show green DONE progress!)
INSERT INTO planned_maintenance_task_instances
  (planned_task_id, occurrence_date, exception_type, status, created_by)
VALUES
-- Today: first 3 daily checks already completed this morning, 2 still TODO for live demo!
(1, CURDATE(),                           'OVERRIDE', 'DONE', 5),
(2, CURDATE(),                           'OVERRIDE', 'DONE', 6),
(3, CURDATE(),                           'OVERRIDE', 'DONE', 5),
-- Yesterday: all 5 daily checks completed
(1, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'OVERRIDE', 'DONE', 5),
(2, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'OVERRIDE', 'DONE', 6),
(3, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'OVERRIDE', 'DONE', 5),
(4, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'OVERRIDE', 'DONE', 4),
(5, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'OVERRIDE', 'DONE', 1),
-- 2 days ago: all 5 daily checks completed
(1, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'OVERRIDE', 'DONE', 3),
(2, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'OVERRIDE', 'DONE', 6),
(3, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'OVERRIDE', 'DONE', 5),
(4, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'OVERRIDE', 'DONE', 4),
(5, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'OVERRIDE', 'DONE', 1),
-- Monthly check #11 completed today!
(11, CURDATE(),                          'OVERRIDE', 'DONE', 4);

-- =============================================================================
-- 14. WORKFORCE SHIFTS (crew roster -5d .. +3d) & SHIFT HANDOVERS (4)
-- =============================================================================
INSERT INTO shifts
  (shift_type_id, user_id, supervisor_id, date, entry_kind, leave_type, custom_start_time, custom_end_time, status, check_in, check_out, notes, overtime_hours, adjustment_reason)
VALUES
-- ── TODAY (6 staff active across MOR / AFT / CST) ───────────────────────────
(1, 2, 1, CURDATE(), 'WORK',   NULL,       NULL,       NULL,       'IN_PROGRESS', TIMESTAMP(CURDATE(), '06:00:00'), NULL, 'Duty Operations Manager',                   0.00, NULL),
(1, 3, 2, CURDATE(), 'WORK',   NULL,       NULL,       NULL,       'IN_PROGRESS', TIMESTAMP(CURDATE(), '06:02:00'), NULL, 'Morning Lead Engineer — BAY-01/02',         0.00, NULL),
(5, 5, 2, CURDATE(), 'CUSTOM', NULL,       '06:00:00', '16:00:00', 'IN_PROGRESS', TIMESTAMP(CURDATE(), '05:55:00'), NULL, 'Extended coverage for BAY-06 actuator',     2.00, 'Overtime — BAY-06 AOG Recovery'),
(1, 6, 2, CURDATE(), 'WORK',   NULL,       NULL,       NULL,       'IN_PROGRESS', TIMESTAMP(CURDATE(), '06:00:00'), NULL, 'Morning TPS / IOS Pre-Flight & Spares',     0.00, NULL),
(2, 4, 2, CURDATE(), 'WORK',   NULL,       NULL,       NULL,       'CONFIRMED',   NULL,                             NULL, 'Afternoon Shift Lead — Visual & IOS-04',    0.00, NULL),
(2, 7, 2, CURDATE(), 'WORK',   NULL,       NULL,       NULL,       'CONFIRMED',   NULL,                             NULL, 'Afternoon Tactical/Rotorcraft — BAY-04/05', 0.00, NULL),

-- ── YESTERDAY (-1d) ─────────────────────────────────────────────────────────
(1, 2, 1, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'14:00:00'), 'Ops duty', 0.00, NULL),
(1, 3, 2, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'14:05:00'), 'Bay support', 0.00, NULL),
(1, 6, 2, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'14:00:00'), 'TPS Shift 1', 0.00, NULL),
(2, 4, 2, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'22:00:00'), 'A350 MEL diagnosis', 0.00, NULL),
(2, 5, 2, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'CUSTOM',NULL, '14:00:00', '23:30:00', 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'23:30:00'), 'BAY-06 servo removal', 1.50, 'Overtime — AOG Actuator'),
(3, 7, 2, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY),'22:00:00'), TIMESTAMP(CURDATE(),'06:00:00'), 'Overnight plant watch', 0.00, NULL),

-- ── DAYS -2..-5 ─────────────────────────────────────────────────────────────
(1, 3, 2, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY),'06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY),'14:00:00'), NULL, 0.00, NULL),
(2, 5, 2, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY),'14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY),'22:00:00'), NULL, 0.00, NULL),
(1, 6, 2, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY),'06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY),'14:00:00'), NULL, 0.00, NULL),
(7, 4, 2, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'LEAVE', 'VACATION', NULL, NULL, 'ON_LEAVE', NULL, NULL, 'Approved annual leave day', 0.00, NULL),
(1, 3, 2, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY),'06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY),'14:00:00'), NULL, 0.00, NULL),
(2, 4, 2, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY),'14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY),'22:00:00'), NULL, 0.00, NULL),
(3, 5, 2, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY),'22:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY),'06:00:00'), NULL, 0.00, NULL),
(1, 7, 2, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY),'06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY),'14:00:00'), NULL, 0.00, NULL),
(1, 2, 1, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY),'06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY),'14:00:00'), NULL, 0.00, NULL),
(1, 3, 2, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY),'06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY),'14:00:00'), NULL, 0.00, NULL),
(2, 6, 2, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY),'14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY),'22:00:00'), NULL, 0.00, NULL),
(1, 4, 2, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY),'06:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY),'14:00:00'), NULL, 0.00, NULL),
(2, 7, 2, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'WORK',  NULL, NULL, NULL, 'COMPLETED', TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY),'14:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY),'22:00:00'), NULL, 0.00, NULL),

-- ── UPCOMING ROSTER (+1d .. +3d) ────────────────────────────────────────────
(1, 2, 1, DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'CONFIRMED', NULL, NULL, 'Ops Duty Manager', 0.00, NULL),
(1, 3, 2, DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'CONFIRMED', NULL, NULL, 'B737 pre-audit fly-out', 0.00, NULL),
(1, 4, 2, DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'CONFIRMED', NULL, NULL, 'Visual QTG validation', 0.00, NULL),
(2, 5, 2, DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'SCHEDULED', NULL, NULL, 'BAY-06 RTS sign-off', 0.00, NULL),
(2, 6, 2, DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'SCHEDULED', NULL, NULL, 'Spares & TPS coverage', 0.00, NULL),
(3, 7, 2, DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'WORK',  NULL, NULL, NULL, 'SCHEDULED', NULL, NULL, 'Night bay watch', 0.00, NULL),
(1, 3, 2, DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'WORK',  NULL, NULL, NULL, 'SCHEDULED', NULL, NULL, NULL, 0.00, NULL),
(2, 4, 2, DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'WORK',  NULL, NULL, NULL, 'SCHEDULED', NULL, NULL, NULL, 0.00, NULL),
(1, 5, 2, DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'WORK',  NULL, NULL, NULL, 'SCHEDULED', NULL, NULL, NULL, 0.00, NULL),
(7, 6, 2, DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'LEAVE', 'VACATION', NULL, NULL, 'ON_LEAVE', NULL, NULL, 'Scheduled PTO', 0.00, NULL),
(1, 2, 1, DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'WORK',  NULL, NULL, NULL, 'SCHEDULED', NULL, NULL, NULL, 0.00, NULL),
(2, 7, 2, DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'WORK',  NULL, NULL, NULL, 'SCHEDULED', NULL, NULL, 'AJT-50 4-ship LVC support', 0.00, NULL);

INSERT INTO shift_handovers
  (shift_date, from_shift_code, to_shift_code, authored_by, acknowledged_by, acknowledged_at, simulators_status_summary, open_drs_summary, pending_actions, safety_loto_notes)
VALUES
-- Today: PENDING ACKNOWLEDGEMENT (demo live "Acknowledge Handover" click!)
(CURDATE(), 'MORNING', 'AFTERNOON', 3, NULL, NULL,
 'BAY-01 (A320) & BAY-05 (AJT-50) IN_SORTIE nominal. BAY-02 & BAY-04 READY. BAY-03 DEGRADED (MEL Cat B). BAY-06 MAINTENANCE. TP-05 NA.',
 'DR-2611-01 (BAY-06 servo drive — QTG-3.A.2 pending); DR-2611-02 (BAY-03 laser MEL Cat B); DR-2611-03 (IOS-04 audio card); DR-2611-04 (TP-05 GPU).',
 '1) Complete BAY-06 QTG-3.A.2 latency verification & remove LOTO #412. 2) Swap IOS-04 audio matrix card at 14:00. 3) Finish TP-05 GPU thermal burn-in.',
 'LOTO TAG #412 ACTIVE on BAY-06 Motion Breaker QF-MOT-01 (Daniel Brooks padlock). Do NOT energize BAY-06 motion without clearing LOTO.'),
-- Earlier today (Night -> Morning, acknowledged)
(CURDATE(), 'NIGHT', 'MORNING', 7, 3, TIMESTAMP(CURDATE(), '06:15:00'),
 'Plant cold start nominal at 06:30. Chiller Loops #1/#2 at 7.1C. BAY-01..05 cleared pre-flight.',
 'BAY-06 remained under LOTO #412 overnight awaiting morning torque verification.',
 'Hand off BAY-06 final calibration to Daniel Brooks at 06:00.',
 'LOTO #412 verified intact on BAY-06.'),
-- Yesterday (Afternoon -> Night, acknowledged)
(DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'AFTERNOON', 'NIGHT', 4, 7, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '22:10:00'),
 'Meridian Global A350 sortie completed with 15 min visual check; BAY-03 placed on MEL Cat B.',
 'Opened DR-2611-02 on BAY-03 Ch.3 laser and DR-2611-03 on IOS-04 audio Ch.2.',
 'Monitor overnight backup job on SRV-QTG-002 and confirm PO tracking for OptiDome laser module.',
 'LOTO #412 applied on BAY-06 at 17:00.'),
-- 2 days ago (acknowledged)
(DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'AFTERNOON', 'NIGHT', 5, 3, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '22:05:00'),
 'BAY-06 TransOceanic sortie interrupted at 16:30 due to Actuator #4 overcurrent trip.',
 'Opened critical AOG Work Order DR-2611-01 on BAY-06 Motion.',
 'Reserve spare MotionTech servo drive MOT-SRV-650 from WH-MAIN for morning install.',
 'BAY-06 motion platform lowered to mechanical park stops and LOTO #412 initiated.');

-- =============================================================================
-- 15. TASK MANAGER (14 tasks incl. Parent + 4 Subtasks & 6 Engineering Comments)
-- =============================================================================
INSERT INTO tasks
  (id, parent_id, category_id, simulator_id, created_by, assigned_to, title, description, interval_type, status, priority, due_date, completed_at, estimated_hours, actual_hours, tags)
VALUES
-- Parent Compliance Audit Task + 4 Subtasks
(1,  NULL, 5, 2, 2, 3, 'Prepare Annual Level D Re-Evaluation Dossier — BAY-02 (B737 MAX)',
 'Complete full annual MQTG compliance dossier, visual optical plots, and open-snag review ahead of regulatory inspector arrival.',
 'ONCE', 'IN_PROGRESS', 'CRITICAL', TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 12 DAY), '17:00:00'), NULL, 16.00, 10.50, '["Compliance","QTG","BAY-02","Audit"]'),
(2,  1,    5, 2, 3, 3, 'Archive Q1-Q3 automated QTG plots to SRV-QTG-002',
 'Verify signed PDF plots for Performance, Handling and Motion QTG quarters.',
 'ONCE', 'DONE',        'HIGH',     TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '17:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '15:00:00'), 3.00, 2.50, '["QTG","Archive"]'),
(3,  1,    5, 2, 3, 4, 'Execute Q4 Manual Visual Luminance & Horizon Collimation (QTG-4.D.1)',
 'Measure all 3 LumaDome LED channels with Konica CS-150 and log delta.',
 'ONCE', 'IN_PROGRESS', 'HIGH',     TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 4 DAY), '23:00:00'), NULL, 4.00, 1.50, '["Visual","QTG"]'),
(4,  1,    5, 2, 3, 5, 'Verify CLS-500 control force plots & motion transport delay certificates',
 'Cross-check Q2/Q3 test sheets against Boeing 737 MAX validation data.',
 'ONCE', 'DONE',        'MEDIUM',   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '17:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '16:20:00'), 3.00, 3.00, '["Motion","CLS"]'),
(5,  1,    5, 2, 2, 8, 'Final QA compliance sign-off & Authority evaluation package upload',
 'Review complete dossier with Quality Auditor before regulatory portal submission.',
 'ONCE', 'TODO',        'HIGH',     TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 10 DAY), '16:00:00'), NULL, 4.00, 0.00, '["Compliance","QA"]'),

-- Operational, Engineering & Logistics Tasks
(6,  NULL, 4, 3, 2, 6, 'Expedite OptiVision 4K Laser Module Shipment (PO-2026-1198)',
 'Track customs clearance for 2x VIS-LSR-6000 laser modules to clear BAY-03 MEL Cat B before expiry.',
 'ONCE', 'IN_PROGRESS', 'CRITICAL', TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 2 DAY), '12:00:00'), NULL, 2.00, 1.50, '["AOG","Spares","BAY-03","MEL"]'),
(7,  NULL, 1, 6, 3, 5, 'Complete BAY-06 Post-Actuator Swap QTG-3.A.2 & Release LOTO #412',
 'Run 6-DOF latency & washout verification after servo drive replacement and release bay for TransOceanic RTS fly-out.',
 'ONCE', 'REVIEW',      'CRITICAL', TIMESTAMP(CURDATE(), '20:00:00'), NULL, 3.50, 3.00, '["BAY-06","Motion","LOTO","RTS"]'),
(8,  NULL, 4, NULL, 6, 6, 'Follow up RMA-MOT-4102 & RMA-FLX-8910 Repair Quotes',
 'Confirm turnaround ETA with vendor repair stations for unserviceable servo drive and audio DSP card.',
 'WEEKLY', 'TODO',      'HIGH',     TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 3 DAY), '17:00:00'), NULL, 2.00, 0.00, '["RMA","Warehouse"]'),
(9,  NULL, 3, 11, 4, 4, 'Complete TP-05 GPU Replacement & 2-Hour Thermal Stress Test',
 'Verify visual channel #2 stability under full 60Hz load before returning Test Place 5 to READY.',
 'ONCE', 'IN_PROGRESS', 'HIGH',     TIMESTAMP(CURDATE(), '16:30:00'), NULL, 3.00, 2.00, '["TP-05","Visual","GPU"]'),
(10, NULL, 2, NULL, 2, 3, 'Close Overdue UPS Bank B Annual Load-Bank Test & Update Safety Log',
 'Complete deferred battery discharge test on Electrical Substation B and file compliance sheet.',
 'ONCE', 'OVERDUE',     'HIGH',     TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '18:00:00'), NULL, 2.50, 0.50, '["UPS","Safety","Overdue"]'),
(11, NULL, 1, 5, 7, 7, 'Configure 4-Ship LVC Tactical Scenario Network for Upcoming Academy Sortie',
 'Pre-load threat emitters, terrain mesh, and verify white-force recording on IOS-05.',
 'ONCE', 'TODO',        'MEDIUM',   TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 2 DAY), '15:00:00'), NULL, 4.00, 0.00, '["AJT-50","LVC","Tactical"]'),
(12, NULL, 3, 1, 3, 3, 'Daily Morning Fleet Readiness Brief & Shift Sheet Review',
 'Verify all FFS bays, Test Places and IOS Consoles status at 06:45 local.',
 'DAILY', 'DONE',       'MEDIUM',   TIMESTAMP(CURDATE(), '07:00:00'), TIMESTAMP(CURDATE(), '06:50:00'), 0.50, 0.50, '["Daily","Readiness"]'),
(13, NULL, 5, 4, 2, 7, 'Prepare H145 Offshore Helideck Night NVG Visual Database Update',
 'Validate new North Sea rig lighting model on BAY-04 chin-window dome.',
 'MONTHLY', 'REVIEW',   'MEDIUM',   TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 5 DAY), '17:00:00'), NULL, 5.00, 4.25, '["H145","NVG","Visual"]'),
(14, NULL, 4, NULL, 1, 6, 'Monthly Calibrated Tooling Inventory & ISO 17025 Sticker Audit',
 'Check calibration validity on Konica photometers and torque wrenches in CAL-LAB.',
 'MONTHLY', 'DONE',     'LOW',      TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '17:00:00'), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '14:30:00'), 2.00, 1.75, '["Tooling","ISO"]');

INSERT INTO task_comments (task_id, user_id, content, created_at) VALUES
(1, 3, 'Q1, Q2, and Q3 automated plots verified and uploaded to SRV-QTG-002. Only QTG-4.D.1 visual check remains.', DATE_SUB(NOW(), INTERVAL 1 DAY)),
(1, 2, '@claire.bennett please prioritize QTG-4.D.1 on BAY-02 in the next night slot so Olivia can sign off early.', DATE_SUB(NOW(), INTERVAL 18 HOUR)),
(6, 6, 'Express air freight AWB #884120934 cleared customs hub — delivery confirmed within 4 days.', DATE_SUB(NOW(), INTERVAL 4 HOUR)),
(7, 5, 'New servo drive installed and torqued. Preliminary latency measured at 23ms — preparing final QTG-3.A.2 sign-off.', DATE_SUB(NOW(), INTERVAL 2 HOUR)),
(9, 4, 'Swapped RTX 6000 Ada card on TP-05; currently running 60Hz scene stress test at 62C steady.', DATE_SUB(NOW(), INTERVAL 1 HOUR)),
(10, 3, 'Scheduled UPS Bank B load test immediately after BAY-06 returns to service tonight.', DATE_SUB(NOW(), INTERVAL 5 HOUR));

-- =============================================================================
-- 16. PROACTIVE NOTIFICATIONS & AUDIT LOGS
-- =============================================================================
INSERT INTO notifications (user_id, type, title, body, link, is_read, created_at) VALUES
(1, 'AOG_SPARE_LOW',    'AOG Critical Stockout: VIS-LSR-6000',     'OptiDome 6000 4K Laser Engine Module is at 0 units (2 units on order, ETA +4d).',   '/warehouse?tab=reorder',   FALSE, DATE_SUB(NOW(), INTERVAL 3 HOUR)),
(1, 'MEL_EXPIRING',     'MEL Cat B Expiry in 3 Days: BAY-03',      'DR-2611-02 (A350 Visual Ch.3 dimmer) MEL Cat B expires in 3 days.',                 '/maintenance',             FALSE, DATE_SUB(NOW(), INTERVAL 2 HOUR)),
(1, 'CERT_EXPIRING',    'FSTD Certificate Expiring (18d): BAY-02', 'FFS-B737-02 certificate FSTD.INT.022 requires annual re-evaluation in 18 days.',    '/simulators?id=2',         FALSE, DATE_SUB(NOW(), INTERVAL 5 HOUR)),
(1, 'HANDOVER_PENDING', 'Shift Handover Awaiting Acknowledgement', 'Morning -> Afternoon handover by David Miller includes active LOTO #412 on BAY-06.','/shifts',                  FALSE, DATE_SUB(NOW(), INTERVAL 40 MINUTE)),
(1, 'QTG_FAILED',       'QTG-3.A.2 Failed on BAY-06 (B787-9)',     'Actuator #4 pitch latency exceeded 40ms limit; linked to Work Order DR-2611-01.',   '/maintenance?tab=qtg',     TRUE,  DATE_SUB(NOW(), INTERVAL 1 DAY)),
(2, 'AOG_SPARE_LOW',    'AOG Critical Stockout: VIS-LSR-6000',     'OptiDome 6000 4K Laser Engine Module is at 0 units (PO inbound).',                  '/warehouse?tab=reorder',   FALSE, DATE_SUB(NOW(), INTERVAL 3 HOUR)),
(2, 'MEL_EXPIRING',     'MEL Cat B Active on BAY-03 (A350-900)',   'Brief Meridian Global crew on LVP Cat III restriction for 14:00 LOFT sortie.',      '/operations',              FALSE, DATE_SUB(NOW(), INTERVAL 1 HOUR)),
(3, 'TASK_ASSIGNED',    'Annual BAY-02 Dossier Review Scheduled',  'Sarah Chen assigned Q4 compliance prep milestone for FFS-B737-02.',                 '/tasks?id=1',              TRUE,  DATE_SUB(NOW(), INTERVAL 18 HOUR));

INSERT INTO audit_logs (user_id, username, action, ip, method, path, status, details, created_at) VALUES
(1, 'admin',          'AUTH_LOGIN',           '10.20.4.12', 'POST',  '/api/auth/login',                         200, '{"role":"admin"}',                                     DATE_SUB(NOW(), INTERVAL 25 MINUTE)),
(2, 'sarah.chen',     'SORTIE_DISPATCH',      '10.20.4.18', 'POST',  '/api/operations',                         201, '{"sortie_code":"SRT-TDY-05","bay":"BAY-03"}',          DATE_SUB(NOW(), INTERVAL 4 HOUR)),
(6, 'hannah.patel',   'DAILY_OPS_UPDATE',     '10.20.4.22', 'PUT',   '/api/simulators/daily-ops/entries',       200, '{"station_kind":"TEST_PLACE","shift":"SHIFT 1"}',      DATE_SUB(NOW(), INTERVAL 3 HOUR)),
(4, 'claire.bennett', 'STOCK_MOVEMENT_OUT',   '10.20.4.31', 'POST',  '/api/warehouse/3/movement',               201, '{"sku":"IG-GPU-6000A","qty":1,"bay":"TP-05"}',         DATE_SUB(NOW(), INTERVAL 3 HOUR)),
(5, 'daniel.brooks',  'WORK_ORDER_UPDATE',    '10.20.4.29', 'PUT',   '/api/maintenance/1',                      200, '{"status":"IN_PROGRESS","loto":"412"}',                DATE_SUB(NOW(), INTERVAL 2 HOUR)),
(3, 'david.miller',   'SHIFT_HANDOVER_LOG',   '10.20.4.19', 'POST',  '/api/shifts/handovers',                   201, '{"from":"MORNING","to":"AFTERNOON"}',                  DATE_SUB(NOW(), INTERVAL 40 MINUTE)),
(6, 'hannah.patel',   'PLANNED_OCCURRENCE',   '10.20.4.22', 'PUT',   '/api/maintenance/planned/2/occurrence',   200, '{"status":"DONE"}',                                    DATE_SUB(NOW(), INTERVAL 3 HOUR)),
(2, 'sarah.chen',     'EXPORT_REPORT_PDF',    '10.20.4.18', 'GET',   '/api/export/dashboard?format=pdf',        200, '{"period":"weekly"}',                                  DATE_SUB(NOW(), INTERVAL 1 HOUR)),
(8, 'olivia.grant',   'EXPORT_REPORT_DOCX',   '10.20.4.40', 'GET',   '/api/export/simulators?format=docx',      200, '{"period":"monthly"}',                                 DATE_SUB(NOW(), INTERVAL 1 DAY)),
(5, 'daniel.brooks',  'QTG_RECORD_LOGGED',    '10.20.4.29', 'PUT',   '/api/simulators/6/qtg',                   200, '{"test_code":"QTG-3.A.2","status":"FAILED"}',          DATE_SUB(NOW(), INTERVAL 2 DAY));

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- FINAL DEMO SEED VERIFICATION SUMMARY
-- =============================================================================
SELECT
  (SELECT COUNT(*) FROM users)                     AS users_loaded,
  (SELECT COUNT(*) FROM simulators)                AS stations_total,
  (SELECT COUNT(*) FROM simulator_subsystems)      AS subsystems_loaded,
  (SELECT COUNT(*) FROM simulator_qtg_records)     AS qtg_tests_loaded,
  (SELECT COUNT(*) FROM operations)                AS sorties_loaded,
  (SELECT COUNT(*) FROM maintenance_records)       AS work_orders_loaded,
  (SELECT COUNT(*) FROM planned_maintenance_tasks) AS planned_schedules_loaded,
  (SELECT COUNT(*) FROM inventory_items)           AS spares_skus_loaded,
  (SELECT COUNT(*) FROM shifts)                    AS crew_shifts_loaded,
  (SELECT COUNT(*) FROM tasks)                     AS tasks_loaded,
  (SELECT COUNT(*) FROM wiki_articles)             AS wiki_sops_loaded;
