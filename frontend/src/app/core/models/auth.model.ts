export type UserRole = 'operator' | 'viewer';

export interface User {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: { field?: string; message: string }[];
  };
}

