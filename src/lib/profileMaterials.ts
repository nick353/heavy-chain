/**
 * Light's スマート自動入力 for 業務プリファレンスプロファイル: the browser turns each material into something Claude can
 * read (PNG / JPEG / PDF as base64, CSV as text, and the text inside DOCX / XLSX / PPTX), and the server fills the profile.
 */
import { cloudflareDataPlane } from './cloudflareApi';
import { officeText } from './officeText';

export const PROFILE_MATERIAL_ACCEPT = '.pdf,.pptx,.docx,.xlsx,.csv,.jpg,.jpeg,.png';
export const PROFILE_MATERIAL_LIMIT = 8;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;

export type ProfileMaterialPayload = { name: string; kind: 'image' | 'pdf' | 'text'; mediaType?: string; data?: string; text?: string };
export type ExtractedProfile = {
  name: string; categories: string[]; priceMin: string; priceMax: string; currency: string;
  countries: string[]; ages: string[]; channels: string[]; brands: string[]; visual: string; summary: string;
};

export class ProfileMaterialError extends Error {}

const extension = (name: string) => name.toLowerCase().split('.').pop() ?? '';
export const isProfileMaterial = (file: File) => PROFILE_MATERIAL_ACCEPT.split(',').includes(`.${extension(file.name)}`);

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(binary);
}

export async function readProfileMaterial(file: File): Promise<ProfileMaterialPayload> {
  const ext = extension(file.name);
  if (!isProfileMaterial(file)) throw new ProfileMaterialError('対応していない形式です');
  if (file.size > MAX_FILE_BYTES) throw new ProfileMaterialError(`${file.name} が大きすぎます（6MBまで）`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return { name: file.name, kind: 'image', mediaType: ext === 'png' ? 'image/png' : 'image/jpeg', data: toBase64(bytes) };
  if (ext === 'pdf') return { name: file.name, kind: 'pdf', data: toBase64(bytes) };
  const text = ext === 'csv' ? new TextDecoder().decode(bytes) : await officeText(bytes, ext);
  if (!text.trim()) throw new ProfileMaterialError(`${file.name} から文字を読み取れませんでした`);
  return { name: file.name, kind: 'text', text: text.slice(0, MAX_TEXT_CHARS) };
}

/** Sends the materials to Claude and returns only what they state. */
export async function extractProfileFromMaterials(brandId: string, files: File[]): Promise<ExtractedProfile> {
  if (!cloudflareDataPlane) throw new ProfileMaterialError('解析を利用できません');
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) throw new ProfileMaterialError('資料の合計が大きすぎます（6MBまで）');
  const payload = await Promise.all(files.slice(0, PROFILE_MATERIAL_LIMIT).map(readProfileMaterial));
  return cloudflareDataPlane.invokeProviderAction<ExtractedProfile>('profile-extract', { brandId, files: payload });
}
