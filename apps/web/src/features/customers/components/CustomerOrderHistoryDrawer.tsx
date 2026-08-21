import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { CustomerOrderHistory } from './CustomerOrderHistory';

/**
 * Paket sipariş akışında "Geçmiş" tetikleyicisinin açtığı kap — ADR-038 K7.2(2).
 *
 * `Dialog` bir **portal**dır: içerik React ağacında `OrderScreenPage`'in ALTINDA
 * kalır, DOM'da body'ye taşınır. Dolayısıyla açılıp kapanması `OrderScreenPage`'i
 * unmount ETMEZ ve **sepet durumu korunur** (S112 sepet sızıntısı regresyonu,
 * DoD 13). Bu yüzden ayrı bir route/sayfa değil, bilinçli olarak drawer seçildi
 * (ADR-038 Alternatif F).
 *
 * Liste bileşeni tek kopyadır (`CustomerOrderHistory`); burada yalnız kap ve
 * başlık vardır.
 */
interface CustomerOrderHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string | null;
  /** Başlıkta gösterilecek müşteri adı (yalnız görüntü). */
  customerName?: string | null;
}

export function CustomerOrderHistoryDrawer({
  open,
  onOpenChange,
  customerId,
  customerName,
}: CustomerOrderHistoryDrawerProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {customerName
              ? t('customers.orderHistory.drawerTitleNamed', {
                  name: customerName,
                })
              : t('customers.orderHistory.drawerTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {/* `enabled={open}`: drawer kapalıyken sorgu HİÇ atılmaz (K7.5). */}
          <CustomerOrderHistory customerId={customerId} enabled={open} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
