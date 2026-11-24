import { z } from "zod";

export const idSchema = z.uuid();
const shortText = z.string().trim().max(200).refine(value=>!value.includes("\0"));
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}, "أدخل تاريخًا صحيحًا");
export const profileSchema = z.strictObject({
  name: shortText.min(1), registration:shortText.max(30), activity:shortText,
  city:shortText, email:z.union([z.email(),z.literal("")]), phone:shortText.max(30)
});
export const employeeSchema = z.strictObject({
  name:shortText.min(1),job:shortText.min(1),nationality:z.enum(["saudi","other"]),
  monthlySalary:z.number().finite().min(0).max(10_000_000),documentExpiry:isoDate.nullable().optional().default(null)
});
export const taskSchema = z.strictObject({ title:shortText.min(1),dueDate:isoDate.nullable().optional().default(null) });
export const taskUpdateSchema = z.strictObject({status:z.enum(["todo","done"])});
export const letterSchema = z.strictObject({
  title:shortText.min(1), recipient:shortText, subject:shortText.min(1), body:z.string().trim().min(1).max(40_000).refine(value=>!value.includes("\0"))
});
