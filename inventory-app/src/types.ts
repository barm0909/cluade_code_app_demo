export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  quantity: number;
  minQuantity: number;
  price: number;
  updatedAt: string;
}

export type SortField = keyof Pick<Product, 'name' | 'sku' | 'category' | 'quantity' | 'price'>;
export type SortOrder = 'asc' | 'desc';
