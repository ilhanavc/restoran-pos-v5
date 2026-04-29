import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { env } from '../../lib/env';

interface ForgotPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Şifremi unuttum" — Karar B (admin-mediated, ADR-011 §11.2).
 * No backend round-trip: we surface the support phone and ask the user to
 * contact the restaurant admin who can reset via /users.
 */
export function ForgotPasswordModal({ open, onOpenChange }: ForgotPasswordModalProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('auth.forgotPassword.title')}</DialogTitle>
          <DialogDescription>{t('auth.forgotPassword.body')}</DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          <span className="text-muted-foreground">{t('auth.forgotPassword.phoneLabel')}: </span>
          <a
            href={`tel:${env.VITE_SUPPORT_PHONE.replace(/\s+/g, '')}`}
            className="font-medium text-primary hover:underline"
          >
            {env.VITE_SUPPORT_PHONE}
          </a>
        </p>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('auth.forgotPassword.closeButton')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
