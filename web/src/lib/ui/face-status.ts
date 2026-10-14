/** A player's roster status as his face marks it. One today: injured reserve. */
export type FaceStatus = 'ir';

export const FACE_STATUS = {
	/** The mark's letters on the face. */
	marks: { ir: 'IR' },
	/** What the mark says to assistive tech. */
	words: { ir: 'on injured reserve' },
	/** From this diameter up the mark draws larger and sits inside the circle's corner. */
	largeFrom: 72
} as const satisfies {
	marks: Record<FaceStatus, string>;
	words: Record<FaceStatus, string>;
	largeFrom: number;
};
