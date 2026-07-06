import type { AuthUser } from "../types";

export function shouldOfferCompletedMatchLogin({
  currentUser,
  seatToken,
  httpStatus,
}: {
  currentUser: AuthUser | null;
  seatToken?: string;
  httpStatus?: number;
}) {
  return !currentUser && !seatToken && (httpStatus === 401 || httpStatus === 404);
}
