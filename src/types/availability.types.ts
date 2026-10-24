import { z } from 'zod';

export type AccountType = 'INDIVIDUAL' | 'ENTERPRISE';
export type SlotType = 'FREE_TIME' | 'BUSY_CLASS' | 'BUSY_EXAM' | 'OTHER';

export const AvailabilitySlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6, 'dayOfWeek phải nằm trong khoảng từ 0 (Chủ nhật) đến 6 (Thứ 7)'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'startTime phải đúng định dạng HH:mm (00:00 - 23:59)'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'endTime phải đúng định dạng HH:mm (00:00 - 23:59)'),
  slotType: z.enum(['FREE_TIME', 'BUSY_CLASS', 'BUSY_EXAM', 'OTHER']).optional().default('FREE_TIME'),
});

export const UpdateAvailabilitySlotsSchema = z.object({
  slots: z.array(AvailabilitySlotSchema),
});

export type AvailabilitySlotInput = z.infer<typeof AvailabilitySlotSchema>;
export type UpdateAvailabilitySlotsInput = z.infer<typeof UpdateAvailabilitySlotsSchema>;

export interface UserAvailabilitySlotDto {
  id: string;
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotType: SlotType;
  createdAt: string;
}

export interface UserAvailabilityResponseData {
  userId: string;
  slots: UserAvailabilitySlotDto[];
}

