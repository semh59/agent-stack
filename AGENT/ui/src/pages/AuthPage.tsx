import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { LogIn, AlertCircle, CheckCircle } from 'lucide-react';
import { validateAuthCredentials, PasswordSchema, EmailSchema } from '../../../src/validators/auth';

export function AuthPage() {
  const navigate = useNavigate();
  const { selectAccount } = useAppStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Real-time email validation
  const validateEmail = (value: string): boolean => {
    if (!value) {
      setErrors(prev => ({ ...prev, email: '' }));
      return false;
    }
    const result = EmailSchema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues[0]?.message || 'Invalid email';
      setErrors(prev => ({ ...prev, email: message }));
      return false;
    }
    setErrors(prev => ({ ...prev, email: '' }));
    return true;
  };

  // Real-time password validation
  const validatePassword = (value: string): boolean => {
    if (!value) {
      setErrors(prev => ({ ...prev, password: '' }));
      return false;
    }
    const result = PasswordSchema.safeParse(value);
    if (!result.success) {
      // Show the first validation error
      const message = result.error.issues[0]?.message || 'Password does not meet requirements';
      setErrors(prev => ({ ...prev, password: message }));
      return false;
    }
    setErrors(prev => ({ ...prev, password: '' }));
    return true;
  };

  // Get password strength indicator
  const getPasswordStrength = (): { level: 'weak' | 'fair' | 'good' | 'strong'; color: string } => {
    if (!password) return { level: 'weak', color: 'bg-red-500' };

    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) strength++;

    if (strength <= 1) return { level: 'weak', color: 'bg-red-500' };
    if (strength <= 3) return { level: 'fair', color: 'bg-yellow-500' };
    if (strength <= 4) return { level: 'good', color: 'bg-blue-500' };
    return { level: 'strong', color: 'bg-green-500' };
  };

  const strength = getPasswordStrength();

  // Check if form is valid
  const isFormValid = EmailSchema.safeParse(email).success &&
                      PasswordSchema.safeParse(password).success;

  const handleEmailChange = (value: string) => {
    setEmail(value);
    validateEmail(value);
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    validatePassword(value);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setApiError(null);

    // Validate before submission
    const result = validateAuthCredentials({ email, password });
    if (!result.valid) {
      const newErrors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(result.errors)) {
        newErrors[field] = messages[0];
      }
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      // Mock authentication (in real app, would call backend API)
      // const response = await fetch('/api/auth/login', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'X-CSRF-Token': await getCsrfToken(),
      //   },
      //   body: JSON.stringify({ email, password }),
      // });

      // if (!response.ok) {
      //   const errorData = await response.json();
      //   setApiError(errorData.message || 'Authentication failed');
      //   return;
      // }

      // For now, just store the email and navigate
      selectAccount(email);
      navigate('/mission');
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-loji-bg)] flex items-center justify-center relative overflow-hidden">

      {/* Background geometrical effect per design plan */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[20%] left-[30%] w-[40vw] h-[40vw] bg-[var(--color-loji-accent)]/5 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[20%] right-[20%] w-[30vw] h-[30vw] bg-[var(--color-loji-mgmt)]/5 rounded-full blur-[100px]" />
      </div>

      <div className="z-10 w-full max-w-md p-8 rounded-xl border border-[var(--color-loji-border)] bg-[var(--color-loji-surface)]/80 backdrop-blur-xl shadow-2xl flex flex-col items-center text-center">

        <h1 className="text-4xl font-display tracking-widest text-white mb-2">
          LOJINEXT
        </h1>
        <p className="text-[var(--color-loji-text-sec)] text-sm tracking-wide font-ui mb-10">
          Sovereign Software Factory
        </p>

        {/* API Error Alert */}
        {apiError && (
          <div className="w-full mb-4 p-3 rounded-md bg-red-500/10 border border-red-500/30 flex gap-2">
            <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{apiError}</p>
          </div>
        )}

        <form
          className="w-full space-y-4"
          onSubmit={handleSubmit}
        >
          {/* Email Field */}
          <div className="space-y-1 text-left">
            <div className="flex items-center justify-between">
              <label className="text-xs text-[var(--color-loji-text-sec)] font-ui">
                Google Email Adresi
              </label>
              {!errors.email && email && EmailSchema.safeParse(email).success && (
                <CheckCircle size={14} className="text-green-500" />
              )}
            </div>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              disabled={isSubmitting}
              placeholder="isim@gmail.com"
              className={`w-full bg-[var(--color-loji-bg)] border rounded-md px-4 py-3 text-sm text-white focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                errors.email
                  ? 'border-red-500/50 focus:border-red-500/50'
                  : 'border-[var(--color-loji-border)] focus:border-[var(--color-loji-accent)]'
              }`}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
            />
            {errors.email && (
              <p id="email-error" className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={12} /> {errors.email}
              </p>
            )}
          </div>

          {/* Password Field */}
          <div className="space-y-1 text-left">
            <label className="text-xs text-[var(--color-loji-text-sec)] font-ui">
              App Password / Şifre
            </label>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(e) => handlePasswordChange(e.target.value)}
              disabled={isSubmitting}
              placeholder="••••••••"
              className={`w-full bg-[var(--color-loji-bg)] border rounded-md px-4 py-3 text-sm text-white focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                errors.password
                  ? 'border-red-500/50 focus:border-red-500/50'
                  : 'border-[var(--color-loji-border)] focus:border-[var(--color-loji-accent)]'
              }`}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
            />
            {errors.password && (
              <p id="password-error" className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={12} /> {errors.password}
              </p>
            )}

            {/* Password Strength Indicator */}
            {password && (
              <div className="space-y-1 mt-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${strength.color} transition-all duration-200`}
                      style={{ width: `${(Object.values(['weak', 'fair', 'good', 'strong']).indexOf(strength.level) + 1) * 25}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--color-loji-text-sec)]">
                    {strength.level === 'weak' && 'Weak'}
                    {strength.level === 'fair' && 'Fair'}
                    {strength.level === 'good' && 'Good'}
                    {strength.level === 'strong' && 'Strong'}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-loji-text-sec)]">
                  Requirements: 8+ chars, uppercase, lowercase, number, special char
                </p>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!isFormValid || isSubmitting}
            className="w-full flex items-center justify-center gap-3 bg-white text-black py-3 px-6 rounded-md hover:bg-gray-100 transition-colors font-medium text-sm mt-6 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            <LogIn size={18} />
            {isSubmitting ? 'Signing in...' : 'Bağlan & Giriş Yap'}
          </button>
        </form>

        <div className="mt-8 text-xs text-[var(--color-loji-text-sec)] space-y-2 border-t border-[var(--color-loji-border)] pt-6 w-full">
          <p>İlk hesap fabrika hesabı olur.</p>
          <p>Sonradan quota rotasyonu için daha fazla hesap ekleyebilirsiniz.</p>
        </div>
      </div>
    </div>
  );
}

