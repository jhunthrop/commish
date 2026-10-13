/**
 * The run format's shared field shapes, in their own module so the schema and the files that extend
 * it (the season block) read one spelling without importing each other.
 */
import { z } from 'zod';

const FORMAT_ID = /^[a-z0-9]+(-[a-z0-9]+)*-[0-9]{1,2}$/;
const CLUB = /^[A-Z]{2,3}$/;

export const formatId = z.string().regex(FORMAT_ID, 'A format id reads like ppr-12.');
export const club = z.string().regex(CLUB, 'A club is its two or three letter code.');
