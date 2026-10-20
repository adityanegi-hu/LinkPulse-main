import { User } from '../../types';
import { db } from '../../lib/api/mockDb';
import { LocalStore } from '../../lib/api/localStore';
import { httpClient } from '../../lib/api/httpClient';

export const authService = {
  async getUserCount(): Promise<number> {
    try {
      const data = await httpClient.get<{ count: number }>('/auth/count');
      if (typeof data?.count === 'number') {
        return data.count;
      }
    } catch {
      // Fallback to local store
    }
    return db.getUserCount();
  },

  async getCurrentUser(): Promise<User | null> {
    try {
      const data = await httpClient.get<{ user: any }>('/auth/me');
      if (data?.user) {
        const u: User = {
          id: data.user.id || data.user._id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
          createdAt: data.user.createdAt || new Date().toISOString(),
          passwordHash: '',
          salt: '',
        };
        LocalStore.setCurrentUser(u);
        return u;
      }
    } catch {
      // If unauthorized or network error, fallback to local session
    }

    const session = await db.getCurrentSession();
    if (session) return session;
    return LocalStore.getCurrentUser();
  },

  async login(email: string, passwordPlain: string): Promise<User> {
    const cleanEmail = email.trim().toLowerCase();

    try {
      const data = await httpClient.post<{ user: any; token: string }>('/auth/login', {
        email: cleanEmail,
        password: passwordPlain,
      });

      if (data?.user && data.token) {
        const u: User = {
          id: data.user.id || data.user._id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
          createdAt: data.user.createdAt || new Date().toISOString(),
          passwordHash: '',
          salt: '',
        };
        localStorage.setItem('lp_token', data.token);
        LocalStore.setCurrentUser(u, data.token);
        return u;
      }
    } catch (err: any) {
      // If real backend explicitly rejected credentials, propagate error
      if (err.status === 401 || err.status === 400) {
        throw err;
      }
      // If network offline, try fallback local mockdb
    }

    const user = await db.login(cleanEmail, passwordPlain);
    LocalStore.setCurrentUser(user, 'local_token_' + user.id);
    return user;
  },

  async register(name: string, email: string, passwordPlain: string): Promise<User> {
    const cleanEmail = email.trim().toLowerCase();

    try {
      const data = await httpClient.post<{ user: any; token: string }>('/auth/register', {
        name: name.trim(),
        email: cleanEmail,
        password: passwordPlain,
      });

      if (data?.user && data.token) {
        const u: User = {
          id: data.user.id || data.user._id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
          createdAt: data.user.createdAt || new Date().toISOString(),
          passwordHash: '',
          salt: '',
        };
        localStorage.setItem('lp_token', data.token);
        LocalStore.setCurrentUser(u, data.token);
        return u;
      }
    } catch (err: any) {
      if (err.status === 400 || err.status === 409) {
        throw err;
      }
    }

    const user = await db.register(name.trim(), cleanEmail, passwordPlain);
    LocalStore.setCurrentUser(user, 'local_token_' + user.id);
    return user;
  },

  async logout(): Promise<void> {
    try {
      await httpClient.post('/auth/logout');
    } catch {
      // Ignore network errors on logout
    }
    await db.setSession(null);
    LocalStore.setCurrentUser(null);
    localStorage.removeItem('lp_token');
    sessionStorage.removeItem('lp_token');
  },

  async bootstrapAdmin(data: { name: string; email: string; passwordPlain: string }): Promise<User> {
    try {
      const res = await httpClient.post<{ user: any }>('/auth/bootstrap-admin', {
        name: data.name,
        email: data.email,
        password: data.passwordPlain,
      });
      if (res?.user) {
        const u: User = {
          id: res.user.id || res.user._id,
          name: res.user.name,
          email: res.user.email,
          role: 'admin',
          createdAt: new Date().toISOString(),
          passwordHash: '',
          salt: '',
        };
        return u;
      }
    } catch {
      // Fallback
    }

    const user = await db.register(data.name, data.email, data.passwordPlain);
    user.role = 'admin';
    await db.updateUserRole(user.id, 'admin');
    await db.setSession(user);
    LocalStore.setCurrentUser(user, 'local_token_' + user.id);
    return user;
  },
};
