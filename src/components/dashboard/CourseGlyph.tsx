"use client";

import { courseIconIndexFromId } from "@/lib/course-avatar";
import {
  IconAtomCourse,
  IconBookCourse,
  IconChartCourse,
  IconChipCourse,
  IconCodeCourse,
  IconCourses,
  IconFlask,
  IconGlobeCourse,
  IconLayersCourse,
  IconPenCourse,
} from "./icons";

const COURSE_ICONS = [
  IconBookCourse,
  IconCourses,
  IconFlask,
  IconCodeCourse,
  IconChartCourse,
  IconGlobeCourse,
  IconPenCourse,
  IconLayersCourse,
  IconChipCourse,
  IconAtomCourse,
] as const;

type CourseGlyphProps = { courseId: string; className?: string };

export function CourseGlyph({ courseId, className = "h-5 w-5" }: CourseGlyphProps) {
  const idx = courseIconIndexFromId(courseId, COURSE_ICONS.length);
  const Icon = COURSE_ICONS[idx] ?? COURSE_ICONS[0];
  return <Icon className={className} />;
}
