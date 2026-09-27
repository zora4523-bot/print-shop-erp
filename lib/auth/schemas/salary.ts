// 薪资：考勤（SPEC §5）
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { YMD_RE, optionalTrimmedText, parseStrictYmd, safeId } from './shared';

// Reusable strict-calendar YYYY-MM-DD field.
const ymdField = (label: string) =>
  z
    .string()
    .trim()
    .superRefine((val, ctx) => {
      if (!YMD_RE.test(val)) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}格式非法（应为 YYYY-MM-DD）`,
        });
        return;
      }
      if (!parseStrictYmd(val)) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}不是合法日历日期`,
        });
      }
    });

// Hours field: accepts number or numeric string; "" / null → 0
// (foreman may leave a field blank to mean "didn't work those hours").
// Rejects negative / non-numeric / > 24.
const hoursField = (label: string) =>
  z.preprocess(
    (v) => {
      if (v === null || v === undefined || v === '') return 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t === '') return 0;
        if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return Number.NaN;
        return Number.parseFloat(t);
      }
      return Number.NaN;
    },
    z
      .number()
      .min(0, `${label}不能为负`)
      .max(24, `${label}超出 24 小时`),
  );

const attendanceUnitField = (label: string, fallback: number) =>
  z.preprocess(
    (value) =>
      value === null || value === undefined || value === ''
        ? fallback
        : typeof value === 'string'
          ? Number(value)
          : value,
    z
      .number()
      .refine(
        (value) => value === 0 || value === 0.5 || value === 1,
        `${label}只支持 0、0.5、1 天`,
      ),
  );

export const recordAttendanceSchema = z
  .object({
    workerId: safeId('员工 id'),
    date: ymdField('考勤日期'),
    normalHours: hoursField('正常工时'),
    otHours: hoursField('加班工时'),
    workUnits: attendanceUnitField('实际上班', 1),
    leaveUnits: attendanceUnitField('请假', 0),
    leaveType: optionalTrimmedText('请假类型', 50).optional(),
    remark: optionalTrimmedText('备注', 200).optional(),
  })
  .refine((value) => value.workUnits + value.leaveUnits <= 1, {
    path: ['leaveUnits'],
    message: '上班天数与请假天数合计不能超过 1 天',
  })
  .refine((value) => value.normalHours + value.otHours <= 24, {
    path: ['otHours'],
    message: '正常工时与加班工时合计不能超过 24 小时',
  });

export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;

export const removeAttendanceSchema = z.object({
  workerId: safeId('工人 id'),
  date: ymdField('考勤日期'),
});

export type RemoveAttendanceInput = z.infer<typeof removeAttendanceSchema>;
