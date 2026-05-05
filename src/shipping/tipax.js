const createTipaxShipment = async ({orderId, address, items, total}) => {
    const trackingCode = `TPX-${String(orderId).slice(0, 8).toUpperCase()}`;
    console.log(
        JSON.stringify(
            {
                event: "tipax.create_shipment",
                orderId,
                trackingCode,
                address,
                items,
                total,
                createdAt: new Date().toISOString(),
            },
            null,
            0
        )
    );
    return {trackingCode};
};

module.exports = {createTipaxShipment};

