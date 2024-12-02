import logger from '../../logger';
import PricesRepository from '../../repositories/PricesRepository';
import { query } from '../../utils/axios-query';
import priceUpdater, { PriceFeed, PriceHistory } from '../price-updater';

class XeggexApi implements PriceFeed {
        public name: string = 'Xeggex';
    public currencies: string[] = ['USD'];
    public url: string = 'https://api.xeggex.com/api/v2/ticker/EAC_USDT';
    public urlHist: string = 'https://api.xeggex.com/api/v2/market/candles?symbol=EAC%2FUSDT&from={TIMESTAMP1}&to={TIMESTAMP2}&resolution={GRANULARITY}&countBack=24';

    constructor() {
    }

        public async $fetchPrice(currency): Promise<number> {
                const response = await query(this.url);
        if (response && response['last_price']) {
            return parseFloat(response['last_price']);
        }
        else {
            return -1;
        }
        }

        public async $fetchRecentPrice(currencies: string[], type: 'hour' | 'day'): Promise<PriceHistory> {
        const timestamp = Date.now().toString();
        const priceHistory = {};
        for (const currency of currencies) {
            if (this.currencies.includes(currency) === false) {
                continue;
            }
                        const response = await query(this.urlHist.replace('{GRANULARITY}', type === 'hour' ? '60' : '1440').replace('{TIMESTAMP1}', timestamp).replace('{TIMESTAMP2}', timestamp));
                        const pricesRaw = response ? response['bars'] : [];

            for (const price of pricesRaw) {
                const time = Math.round(price.time / 1000);
                if (priceHistory[time] === undefined) {
                    priceHistory[time] = priceUpdater.getEmptyPricesObj();
                }
                priceHistory[time][currency] = price.close;
            }
        }
        return priceHistory;
    }


    /**
     * Fetch weekly price and save it into the database
     */
    public async $insertHistoricalPrice(): Promise<void> {
        const timestamp = Date.now().toString();
        const existingPriceTimes = await PricesRepository.$getPricesTimes();
        // EUR weekly price history goes back to timestamp 1378944000 (September 12, 2013)
        // USD weekly price history goes back to timestamp 1383782400 (November 7, 2013)
        // GBP weekly price history goes back to timestamp 1588204800 (April 30, 2020)
        // JPY weekly price history goes back to timestamp 1603324800 (October 22, 2020)
        // AUD weekly price history goes back to timestamp 1591833600 (June 11, 2020)
        let priceHistory = {}; // map: timestamp -> Prices
        for (const currency of this.currencies) {
            const response = await query(this.urlHist.replace('{GRANULARITY}', '1440').replace('{TIMESTAMP1}', timestamp).replace('{TIMESTAMP2}', timestamp));
            const priceHistoryRaw = response ? response['bars'] : [];

            for (const price of priceHistoryRaw) {
                const time = Math.round(price.time / 1000);
                if (existingPriceTimes.includes(time)) {
                    continue;
                }
                if (priceHistory[time] === undefined) {
                    priceHistory[time] = priceUpdater.getEmptyPricesObj();
                }
                priceHistory[time][currency] = price.close;
            }
        }
        for (const time in priceHistory) {
            if (priceHistory[time].USD === -1) {
                delete priceHistory[time];
                continue;
            }
            await PricesRepository.$savePrices(parseInt(time, 10), priceHistory[time]);
        }
        if (Object.keys(priceHistory).length > 0) {
            logger.info(`Inserted ${Object.keys(priceHistory).length} Xeggex USD weekly price history into db`, logger.tags.mining);
        }
    }
}
export default XeggexApi;
