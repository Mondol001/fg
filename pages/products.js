import ProductCard from '../components/ProductCard';

const products = [
  { id: 1, name: 'Product 1', price: 100, image: '/product1.jpg' },
  { id: 2, name: 'Product 2', price: 200, image: '/product2.jpg' },
  { id: 3, name: 'Product 3', price: 300, image: '/product3.jpg' },
];

export default function Products() {
  return (
    <div>
      <h1>Our Products</h1>
      <div className="product-list">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}