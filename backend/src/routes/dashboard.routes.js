const router = require('express').Router();
const { parseDateFilter } = require('../middleware/error.middleware');
const {
  sequelize,
  Simulator,
  SimulatorSubsystem,
  SimulatorQtgRecord,
  Operation,
  OperationType,
  OperationMember,
  MaintenanceRecord,
  Asset,
  AssetCategory,
  InventoryItem,
  WarehouseLocation,
  ItemCategory,
  StockMovement,
  Task,
  Shift,
  ShiftType,
  User
} = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const { expandOccurrencesInRange, formatDateOnly } = require('../services/planned-recurrence.service');
const { computeSimulatorTelemetry } = require('../services/simulator-helpers.service');
const {
  DAY_MS,
  parseTrendDays,
  resolveTrendWindow,
  buildContinuousDailySeries,
  computeFleetReadiness,
  isShiftActiveNow,
  summarizeWarehouseHealth,
  buildUrgentAlertCounts
} = require('../services/dashboard-helpers.service');

/**
 * Group a Sequelize model by `column` and normalize into `{ label, count }[]`.
 */
async function countGrouped(Model, column, where = {}) {
  const rows = await Model.findAll({
    where,
    attributes: [[col(column), 'label'], [fn('COUNT', literal('*')), 'count']],
    group: [col(column)],
    raw: true
  });
  return rows.map((r) => ({ label: r.label, count: Number(r.count) || 0 }));
}

/**
 * Safely expand upcoming Planned Maintenance occurrences over the next 7 days.
 */
async function loadPlannedDueSummary(now = new Date()) {
  try {
    const todayStr = formatDateOnly(now);
    const plus6 = new Date(now.getTime() + 6 * DAY_MS);
    const endStr = formatDateOnly(plus6);
    const occurrences = await expandOccurrencesInRange(todayStr, endStr, 7);

    let todayTotal = 0;
    let todayDone = 0;
    let pendingNext7d = 0;
    const dueList = [];

    for (const occ of occurrences) {
      const occDate = occ.occurrenceDate || String(occ.operationDateStart || '').slice(0, 10);
      const isToday = occDate === todayStr;
      if (isToday) {
        todayTotal += 1;
        if (occ.status === 'DONE') todayDone += 1;
      }
      if (occ.status !== 'DONE') {
        pendingNext7d += 1;
        dueList.push({
          ...occ,
          isToday
        });
      }
    }

    dueList.sort((a, b) => new Date(a.operationDateStart).getTime() - new Date(b.operationDateStart).getTime());

    return {
      todayTotal,
      todayDone,
      pendingNext7d,
      items: dueList.slice(0, 10)
    };
  } catch {
    return {
      todayTotal: 0,
      todayDone: 0,
      pendingNext7d: 0,
      items: []
    };
  }
}

/**
 * GET /api/dashboard/overview
 * Consolidated, parameterized Operational Command Center payload.
 */
router.get('/overview', parseDateFilter, async (req, res, next) => {
  try {
    const now = new Date();
    const trendDays = parseTrendDays(req.query.days);
    const window = resolveTrendWindow(req.dateRange, trendDays, now);
    const { from, to } = req.dateRange || {};

    const opsDateWhere = {};
    const maintDateWhere = {};
    const taskDateWhere = {};
    if (from || to) {
      opsDateWhere.start_date = {};
      maintDateWhere.scheduled_date = {};
      taskDateWhere.created_at = {};
      if (from) {
        opsDateWhere.start_date[Op.gte] = from;
        maintDateWhere.scheduled_date[Op.gte] = from;
        taskDateWhere.created_at[Op.gte] = from;
      }
      if (to) {
        opsDateWhere.start_date[Op.lte] = to;
        maintDateWhere.scheduled_date[Op.lte] = to;
        taskDateWhere.created_at[Op.lte] = to;
      }
    }

    const todayStr = now.toISOString().slice(0, 10);
    const todayStart = new Date(`${todayStr}T00:00:00.000Z`);
    const todayEnd = new Date(`${todayStr}T23:59:59.999Z`);
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

    const [
      totalOps,
      activeOps,
      overdueOpsCount,
      opsByStatus,
      pendingMaint,
      criticalMaintCount,
      overdueMaintCount,
      maintByStatus,
      totalAssets,
      activeAssets,
      maintenanceAssets,
      assetsInMaintenance,
      openTasks,
      completedTasks,
      overdueTasksCount,
      taskByInterval,
      taskByStatus,
      activeInventoryItems,
      movements7dCount,
      activeUsers,
      [opsTrendRows],
      [maintTrendRows],
      [taskTrendRows],
      overdueOperations,
      criticalMaintenance,
      overdueTasks,
      outOfStockAlerts,
      activeAndTodayOps,
      upcomingWorkOrders,
      plannedDue,
      todayShiftsRaw,
      recentOps,
      recentMaint,
      recentTasks,
      recentMovements,
      allSimulators,
      simSorties,
      simMaint,
      simQtg,
      simSubsystems
    ] = await Promise.all([
      Operation.count({ where: opsDateWhere }),
      Operation.count({ where: { status: 'IN_PROGRESS' } }),
      Operation.count({
        where: {
          status: { [Op.in]: ['PLANNED', 'IN_PROGRESS', 'ON_HOLD'] },
          end_date: { [Op.lt]: now }
        }
      }),
      countGrouped(Operation, 'status', opsDateWhere),

      MaintenanceRecord.count({
        where: { ...maintDateWhere, status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] } }
      }),
      MaintenanceRecord.count({
        where: {
          status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'FAILED'] },
          priority: { [Op.in]: ['HIGH', 'CRITICAL'] }
        }
      }),
      MaintenanceRecord.count({
        where: {
          status: 'SCHEDULED',
          scheduled_date: { [Op.lt]: now }
        }
      }),
      countGrouped(MaintenanceRecord, 'status', maintDateWhere),

      Asset.count({ where: { status: { [Op.ne]: 'RETIRED' } } }),
      Asset.count({ where: { status: 'ACTIVE' } }),
      Asset.count({ where: { status: 'UNDER_MAINTENANCE' } }),
      Asset.findAll({
        where: { status: 'UNDER_MAINTENANCE' },
        limit: 5,
        order: [['updated_at', 'DESC']],
        attributes: ['id', 'name', 'serial_number', 'location', 'status'],
        include: [{ model: AssetCategory, as: 'category', attributes: ['id', 'name', 'type'] }]
      }),

      Task.count({ where: { ...taskDateWhere, status: { [Op.in]: ['TODO', 'IN_PROGRESS', 'REVIEW'] } } }),
      Task.count({ where: { ...taskDateWhere, status: 'DONE' } }),
      Task.count({
        where: {
          status: { [Op.in]: ['TODO', 'IN_PROGRESS', 'REVIEW', 'OVERDUE'] },
          due_date: { [Op.lt]: now }
        }
      }),
      countGrouped(Task, 'interval_type', taskDateWhere),
      countGrouped(Task, 'status', taskDateWhere),

      InventoryItem.findAll({
        where: { is_active: true },
        attributes: ['id', 'sku', 'name', 'unit', 'quantity', 'min_stock', 'reorder_point', 'unit_cost', 'supplier'],
        include: [
          { model: WarehouseLocation, as: 'location', attributes: ['id', 'code', 'name'] },
          { model: ItemCategory, as: 'category', attributes: ['id', 'name', 'color'] }
        ]
      }),
      StockMovement.count({ where: { movement_date: { [Op.gte]: sevenDaysAgo } } }),
      User.count({ where: { is_active: true } }),

      sequelize.query(
        `SELECT DATE(start_date) AS date, COUNT(*) AS count
         FROM operations
         WHERE start_date BETWEEN :start AND :end
         GROUP BY DATE(start_date)
         ORDER BY date ASC`,
        { replacements: { start: window.startDate, end: window.endDate } }
      ),
      sequelize.query(
        `SELECT DATE(scheduled_date) AS date, COUNT(*) AS count
         FROM maintenance_records
         WHERE deleted_at IS NULL AND scheduled_date BETWEEN :start AND :end
         GROUP BY DATE(scheduled_date)
         ORDER BY date ASC`,
        { replacements: { start: window.startDate, end: window.endDate } }
      ),
      sequelize.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS count
         FROM tasks
         WHERE created_at BETWEEN :start AND :end
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        { replacements: { start: window.startDate, end: window.endDate } }
      ),

      Operation.findAll({
        where: {
          status: { [Op.in]: ['PLANNED', 'IN_PROGRESS', 'ON_HOLD'] },
          end_date: { [Op.lt]: now }
        },
        limit: 6,
        order: [['end_date', 'ASC']],
        include: [{ model: OperationType, as: 'type', attributes: ['id', 'name', 'color', 'icon'] }]
      }),
      MaintenanceRecord.findAll({
        where: {
          status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS', 'FAILED'] },
          [Op.or]: [
            { priority: { [Op.in]: ['HIGH', 'CRITICAL'] } },
            { status: 'SCHEDULED', scheduled_date: { [Op.lt]: now } }
          ]
        },
        limit: 6,
        order: [['scheduled_date', 'ASC']],
        include: [{ model: Asset, as: 'asset', attributes: ['id', 'name', 'serial_number'] }]
      }),
      Task.findAll({
        where: {
          status: { [Op.in]: ['TODO', 'IN_PROGRESS', 'REVIEW', 'OVERDUE'] },
          [Op.or]: [
            { due_date: { [Op.lt]: now } },
            { priority: 'CRITICAL' }
          ]
        },
        limit: 6,
        order: [['due_date', 'ASC']],
        include: [{ model: User, as: 'assignee', attributes: ['id', 'first_name', 'last_name'] }]
      }),
      InventoryItem.findAll({
        where: { is_active: true, quantity: { [Op.lte]: 0 } },
        limit: 6,
        order: [['quantity', 'ASC']],
        include: [{ model: WarehouseLocation, as: 'location', attributes: ['id', 'code', 'name'] }]
      }),

      Operation.findAll({
        where: {
          [Op.or]: [
            { status: 'IN_PROGRESS' },
            {
              status: { [Op.in]: ['PLANNED', 'ON_HOLD', 'COMPLETED'] },
              start_date: { [Op.between]: [todayStart, todayEnd] }
            }
          ]
        },
        limit: 8,
        order: [['start_date', 'ASC']],
        include: [
          { model: OperationType, as: 'type', attributes: ['id', 'name', 'color', 'icon'] },
          {
            model: OperationMember,
            as: 'members',
            attributes: ['user_id', 'role_in_op'],
            include: [{ model: User, as: 'user', attributes: ['id', 'first_name', 'last_name'] }]
          }
        ]
      }),
      MaintenanceRecord.findAll({
        where: { status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] } },
        limit: 8,
        order: [['scheduled_date', 'ASC']],
        include: [
          { model: Asset, as: 'asset', attributes: ['id', 'name', 'serial_number'] },
          { model: User, as: 'technician', attributes: ['id', 'first_name', 'last_name'] }
        ]
      }),
      loadPlannedDueSummary(now),
      Shift.findAll({
        where: { date: todayStr },
        order: [['id', 'ASC']],
        include: [
          { model: ShiftType, as: 'shiftType' },
          { model: User, as: 'employee', attributes: ['id', 'first_name', 'last_name', 'job_title', 'department'] }
        ]
      }),

      Operation.findAll({
        limit: 8,
        order: [['created_at', 'DESC']],
        include: [{ model: OperationType, as: 'type', attributes: ['id', 'name', 'color', 'icon'] }]
      }),
      MaintenanceRecord.findAll({
        limit: 8,
        order: [['created_at', 'DESC']],
        include: [
          { model: Asset, as: 'asset', attributes: ['id', 'name', 'status'] },
          { model: User, as: 'technician', attributes: ['id', 'first_name', 'last_name'] }
        ]
      }),
      Task.findAll({
        limit: 8,
        order: [['updated_at', 'DESC']],
        include: [{ model: User, as: 'assignee', attributes: ['id', 'first_name', 'last_name', 'avatar_url'] }]
      }),
      StockMovement.findAll({
        limit: 8,
        order: [['movement_date', 'DESC']],
        include: [
          { model: InventoryItem, as: 'item', attributes: ['id', 'name', 'sku', 'unit'] },
          { model: User, as: 'user', attributes: ['id', 'first_name', 'last_name'] }
        ]
      }),
      Simulator.findAll({ order: [['bay_code', 'ASC'], ['code', 'ASC']] }),
      Operation.findAll({
        where: { simulator_id: { [Op.ne]: null }, status: { [Op.ne]: 'CANCELLED' } },
        attributes: ['id', 'simulator_id', 'sortie_code', 'title', 'customer_operator', 'status', 'start_date', 'end_date', 'scheduled_hours', 'lost_training_minutes']
      }),
      MaintenanceRecord.findAll({
        where: { simulator_id: { [Op.ne]: null } },
        attributes: ['id', 'simulator_id', 'status', 'severity', 'is_snag']
      }),
      SimulatorQtgRecord.findAll({ attributes: ['id', 'simulator_id', 'status'] }),
      SimulatorSubsystem.findAll({ attributes: ['id', 'simulator_id', 'subsystem_code', 'status'] })
    ]);

    const fleet = {
      ...computeFleetReadiness({ totalAssets, activeAssets, maintenanceAssets }),
      assetsInMaintenance
    };

    const warehouse = summarizeWarehouseHealth(
      activeInventoryItems.map((row) => row.toJSON()),
      movements7dCount
    );

    const trends = {
      ...buildContinuousDailySeries(
        window.startDateStr,
        window.endDateStr,
        opsTrendRows,
        maintTrendRows,
        taskTrendRows
      ),
      startDate: window.startDateStr,
      endDate: window.endDateStr,
      daysCount: window.daysCount
    };

    const urgentAlerts = {
      overdueOperations,
      criticalMaintenance,
      overdueTasks,
      outOfStock: outOfStockAlerts
    };
    const alertCounts = buildUrgentAlertCounts(urgentAlerts);

    const shiftsEnriched = todayShiftsRaw.map((s) => {
      const plain = s.toJSON();
      return {
        ...plain,
        is_live: isShiftActiveNow(plain, now)
      };
    });

    const shiftTypeBuckets = new Map();
    let liveNow = 0;
    let workShifts = 0;
    let leaveCount = 0;

    for (const s of shiftsEnriched) {
      if (s.is_live) liveNow += 1;
      if (s.entry_kind === 'LEAVE' || s.status === 'ON_LEAVE' || s.shiftType?.category === 'LEAVE') {
        leaveCount += 1;
      } else {
        workShifts += 1;
        const typeKey = s.shiftType?.name || 'Custom';
        const existing = shiftTypeBuckets.get(typeKey) || {
          name: typeKey,
          color: s.shiftType?.color || '#1565C0',
          count: 0
        };
        existing.count += 1;
        shiftTypeBuckets.set(typeKey, existing);
      }
    }

    const sortedTodayOps = [...activeAndTodayOps].sort((a, b) => {
      if (a.status === 'IN_PROGRESS' && b.status !== 'IN_PROGRESS') return -1;
      if (b.status === 'IN_PROGRESS' && a.status !== 'IN_PROGRESS') return 1;
      return new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
    });

    const simulators = allSimulators.map((simRow) => {
      const plain = simRow.toJSON();
      const simId = Number(plain.id);
      return {
        ...plain,
        telemetry: computeSimulatorTelemetry(plain, {
          sorties: simSorties.filter(x => Number(x.simulator_id) === simId).map(x => x.toJSON()),
          maintenance: simMaint.filter(x => Number(x.simulator_id) === simId).map(x => x.toJSON()),
          qtgRecords: simQtg.filter(x => Number(x.simulator_id) === simId).map(x => x.toJSON()),
          subsystems: simSubsystems.filter(x => Number(x.simulator_id) === simId).map(x => x.toJSON()),
          now
        })
      };
    });

    const totalSimulators = simulators.length;
    const readyBays = simulators.filter(s => s.status === 'READY' || s.status === 'PRE_FLIGHT').length;
    const inSortieBays = simulators.filter(s => s.status === 'IN_SORTIE').length;
    const degradedBays = simulators.filter(s => s.status === 'DEGRADED' || s.status === 'MAINTENANCE').length;
    const aogBays = simulators.filter(s => s.status === 'AOG').length;
    const simTodayHours = Math.round(simulators.reduce((acc, s) => acc + (s.telemetry?.todayFlightHours || 0), 0) * 10) / 10;
    const simDispatchRel = totalSimulators > 0
      ? Math.round((simulators.reduce((acc, s) => acc + (s.telemetry?.dispatchReliabilityPct ?? 100), 0) / totalSimulators) * 10) / 10
      : 100;
    const openSnagsCount = simulators.reduce((acc, s) => acc + (s.telemetry?.openSnagsCount || 0), 0);
    const qtgCompliancePct = totalSimulators > 0
      ? Math.round(simulators.reduce((acc, s) => acc + (s.telemetry?.qtgSummary?.completionPct ?? 100), 0) / totalSimulators)
      : 100;

    const simulatorSummary = {
      totalSimulators,
      readyBays,
      inSortieBays,
      degradedBays,
      aogBays,
      todayFlightHours: simTodayHours,
      dispatchReliabilityPct: simDispatchRel,
      openSnagsCount,
      qtgCompliancePct
    };

    res.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        trendDays,
        simulators,
        simulatorSummary,
        kpis: {
          totalOps,
          activeOps,
          overdueOps: overdueOpsCount,
          pendingMaint,
          criticalMaint: criticalMaintCount,
          overdueMaint: overdueMaintCount,
          lowStockCount: warehouse.lowStockCount,
          outOfStockCount: warehouse.outOfStockCount,
          totalSkus: warehouse.totalSkus,
          inventoryValue: warehouse.totalValue,
          openTasks,
          completedTasks,
          overdueTasks: overdueTasksCount,
          activeUsers,
          totalAssets: fleet.totalAssets,
          activeAssets: fleet.activeAssets,
          maintenanceAssets: fleet.maintenanceAssets,
          shiftsToday: shiftsEnriched.length,
          shiftsLiveNow: liveNow,
          plannedDueToday: Math.max(0, plannedDue.todayTotal - plannedDue.todayDone)
        },
        fleet,
        warehouse,
        trends,
        breakdowns: {
          taskByInterval,
          opsByStatus,
          maintByStatus,
          taskByStatus
        },
        urgentAlerts,
        alertCounts,
        todaySchedule: {
          operations: sortedTodayOps,
          upcomingWorkOrders,
          plannedDue
        },
        todayShifts: shiftsEnriched,
        shiftSummary: {
          totalToday: shiftsEnriched.length,
          liveNow,
          workShifts,
          leaveCount,
          byType: Array.from(shiftTypeBuckets.values())
        },
        recentActivity: {
          operations: recentOps,
          maintenance: recentMaint,
          tasks: recentTasks,
          movements: recentMovements
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── Backwards-Compatible Legacy Endpoints (Preserved & Fixed) ────────────────
router.get('/kpis', parseDateFilter, async (req, res, next) => {
  try {
    const now = new Date();
    const { from, to } = req.dateRange || {};
    const where = {};
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = from;
      if (to)   where.created_at[Op.lte] = to;
    }

    const [
      totalOps, activeOps, pendingMaint, lowStockCount, totalSkus, openTasks, activeUsers,
      totalAssets, activeAssets, maintenanceAssets, overdueTasks, criticalMaint,
      [opsTrend], [taskTrend], [maintenanceTrend], taskByInterval
    ] = await Promise.all([
      Operation.count({ where }),
      Operation.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      MaintenanceRecord.count({ where: { ...where, status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] } } }),
      InventoryItem.count({
        where: {
          is_active: true,
          [Op.and]: literal('quantity <= reorder_point')
        }
      }),
      InventoryItem.count({ where: { is_active: true } }),
      Task.count({ where: { ...where, status: { [Op.in]: ['TODO', 'IN_PROGRESS'] } } }),
      User.count({ where: { is_active: true } }),
      Asset.count({ where: { status: { [Op.ne]: 'RETIRED' } } }),
      Asset.count({ where: { status: 'ACTIVE' } }),
      Asset.count({ where: { status: 'UNDER_MAINTENANCE' } }),
      Task.count({
        where: {
          status: { [Op.in]: ['TODO', 'IN_PROGRESS'] },
          due_date: { [Op.lt]: now }
        }
      }),
      MaintenanceRecord.count({
        where: {
          status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] },
          priority: { [Op.in]: ['HIGH', 'CRITICAL'] }
        }
      }),
      sequelize.query(`
        SELECT DATE(start_date) as date, COUNT(*) as count, status
        FROM operations
        WHERE start_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(start_date), status
        ORDER BY date`),
      sequelize.query(`
        SELECT DATE(due_date) as date, interval_type, COUNT(*) as count, status
        FROM tasks
        WHERE due_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(due_date), interval_type, status
        ORDER BY date`),
      sequelize.query(`
        SELECT DATE(scheduled_date) as date, COUNT(*) as count, status
        FROM maintenance_records
        WHERE deleted_at IS NULL AND scheduled_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(scheduled_date), status
        ORDER BY date`),
      countGrouped(Task, 'interval_type', where)
    ]);

    res.json({
      success: true,
      data: {
        kpis: {
          totalOps,
          activeOps,
          pendingMaint,
          lowStockCount,
          totalSkus,
          openTasks,
          activeUsers,
          totalAssets,
          activeAssets,
          maintenanceAssets,
          overdueTasks,
          criticalMaint
        },
        opsTrend,
        taskTrend,
        maintenanceTrend,
        taskByInterval
      }
    });
  } catch (err) { next(err); }
});

router.get('/recent-activity', async (req, res, next) => {
  try {
    const [ops, maint, tasks, movements] = await Promise.all([
      Operation.findAll({
        limit: 8,
        order: [['created_at', 'DESC']],
        include: [{ model: OperationType, as: 'type' }]
      }),
      MaintenanceRecord.findAll({
        limit: 8,
        order: [['created_at', 'DESC']],
        include: [
          { model: Asset, as: 'asset', attributes: ['id', 'name', 'status'] },
          { model: User, as: 'technician', attributes: ['id', 'first_name', 'last_name'] }
        ]
      }),
      Task.findAll({
        limit: 8,
        order: [['updated_at', 'DESC']],
        include: [
          { model: User, as: 'assignee', attributes: ['id', 'first_name', 'last_name', 'avatar_url'] }
        ]
      }),
      StockMovement.findAll({
        limit: 8,
        order: [['movement_date', 'DESC']],
        include: [
          { model: InventoryItem, as: 'item', attributes: ['id', 'name', 'sku', 'unit'] },
          { model: User, as: 'user', attributes: ['id', 'first_name', 'last_name'] }
        ]
      }),
      Simulator.findAll({ order: [['bay_code', 'ASC'], ['code', 'ASC']] }),
      Operation.findAll({
        where: { simulator_id: { [Op.ne]: null }, status: { [Op.ne]: 'CANCELLED' } },
        attributes: ['id', 'simulator_id', 'sortie_code', 'title', 'customer_operator', 'status', 'start_date', 'end_date', 'scheduled_hours', 'lost_training_minutes']
      }),
      MaintenanceRecord.findAll({
        where: { simulator_id: { [Op.ne]: null } },
        attributes: ['id', 'simulator_id', 'status', 'severity', 'is_snag']
      }),
      SimulatorQtgRecord.findAll({ attributes: ['id', 'simulator_id', 'status'] }),
      SimulatorSubsystem.findAll({ attributes: ['id', 'simulator_id', 'subsystem_code', 'status'] })
    ]);

    res.json({
      success: true,
      data: {
        operations: ops,
        maintenance: maint,
        tasks,
        movements
      }
    });
  } catch (err) { next(err); }
});

router.get('/urgent-alerts', async (req, res, next) => {
  try {
    const now = new Date();
    const [overdueOperations, overdueTasks, criticalMaint, outOfStock] = await Promise.all([
      Operation.findAll({
        where: {
          status: { [Op.in]: ['PLANNED', 'IN_PROGRESS', 'ON_HOLD'] },
          end_date: { [Op.lt]: now }
        },
        limit: 5,
        order: [['end_date', 'ASC']],
        include: [{ model: OperationType, as: 'type', attributes: ['id', 'name', 'color', 'icon'] }]
      }),
      Task.findAll({
        where: {
          status: { [Op.in]: ['TODO', 'IN_PROGRESS', 'REVIEW', 'OVERDUE'] },
          [Op.or]: [
            { due_date: { [Op.lt]: now } },
            { priority: 'CRITICAL' }
          ]
        },
        limit: 5,
        order: [['due_date', 'ASC']],
        include: [{ model: User, as: 'assignee', attributes: ['id', 'first_name', 'last_name'] }]
      }),
      MaintenanceRecord.findAll({
        where: {
          status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] },
          priority: { [Op.in]: ['HIGH', 'CRITICAL'] }
        },
        limit: 5,
        order: [['scheduled_date', 'ASC']],
        include: [{ model: Asset, as: 'asset', attributes: ['id', 'name', 'serial_number'] }]
      }),
      InventoryItem.findAll({
        where: {
          is_active: true,
          quantity: { [Op.lte]: 0 }
        },
        limit: 5,
        order: [['quantity', 'ASC']]
      })
    ]);

    res.json({
      success: true,
      data: {
        overdueOperations,
        overdueTasks,
        criticalMaintenance: criticalMaint,
        outOfStock
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
