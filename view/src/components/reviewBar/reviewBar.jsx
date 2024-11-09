import React, { useState, useEffect } from "react";
import { Button, Container, Row, Col } from "react-bootstrap";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FavoriteIcon from "@mui/icons-material/Favorite";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import ReviewInput from "../reviewInput/reviewInput";
import "./reviewBar.scss";
import axios from 'axios'; // Import axios for making API requests

const ReviewBar = ({ srcImg, title, movieId, userId, isLoggedIn }) => {
  // State management for icons and text
  const [watchClicked, setWatchClicked] = useState(false);
  const [likeClicked, setLikeClicked] = useState(false);
  const [watchlistClicked, setWatchlistClicked] = useState(false);
  const [showReviewInput, setShowReviewInput] = useState(false);

  const [hoverText, setHoverText] = useState({
    watch: false,
    like: false,
    watchlist: false,
  });

  useEffect(() => {
    if (isLoggedIn) {
      // Fetch data from the API to check if the movie is reviewed by the user
      axios.get(`http://localhost:8001/movies/${movieId}/reviewed/${userId}`)
        .then(response => {
          if (response.data.reviewed) {
            setWatchClicked(true);
          }
        })
        .catch(error => {
          console.error('Error fetching review status:', error);
        });
    }
  }, [movieId, userId, isLoggedIn]);

  const handleAddReviewClick = () => {
    setShowReviewInput(true);
  };

  const handleCloseReviewInput = () => {
    setShowReviewInput(false);
  };

  // Toggle functions
  const toggleWatch = () => setWatchClicked(!watchClicked);
  const toggleLike = () => setLikeClicked(!likeClicked);
  const toggleWatchlist = () => setWatchlistClicked(!watchlistClicked);

  // Handle hover to change text to "Remove"
  const handleMouseEnter = (icon) => {
    setHoverText({ ...hoverText, [icon]: true });
  };

  const handleMouseLeave = (icon) => {
    setHoverText({ ...hoverText, [icon]: false });
  };

  if (!isLoggedIn) {
    return null; // Jika pengguna tidak login, tidak menampilkan review bar
  }

  return (
    <Container fluid className="review-bar">
      <Row className="text-center d-flex justify-content-center">
        <Col xs={4}>
          <div
            className={`icon-container ${watchClicked ? "watch-active" : ""}`}
            onClick={toggleWatch}
            onMouseEnter={() => handleMouseEnter('watch')}
            onMouseLeave={() => handleMouseLeave('watch')}
          >
            {watchClicked ? (
              <VisibilityIcon className="review-icon" />
            ) : (
              <VisibilityOutlinedIcon className="review-icon" />
            )}
            <span>{hoverText.watch && watchClicked ? 'Remove' : watchClicked ? 'Watched' : 'Watch'}</span>
          </div>
        </Col>
        {/* <Col xs={4}>
          <div
            className={`icon-container ${likeClicked ? "like-active" : ""}`}
            onClick={toggleLike}
            onMouseEnter={() => handleMouseEnter('like')}
            onMouseLeave={() => handleMouseLeave('like')}
          >
            {likeClicked ? (
              <FavoriteIcon className="review-icon" />
            ) : (
              <FavoriteBorderIcon className="review-icon" />
            )}
            <span>{hoverText.like && likeClicked ? 'Remove' : likeClicked ? 'Liked' : 'Like'}</span>
          </div>
        </Col>
        <Col xs={4} className="d-flex justify-content-center">
          <div
            className={`icon-container ${watchlistClicked ? "watchlist-active" : ""}`}
            onClick={toggleWatchlist}
            onMouseEnter={() => handleMouseEnter('watchlist')}
            onMouseLeave={() => handleMouseLeave('watchlist')}
          >
            {watchlistClicked ? (
              <CheckIcon className="review-icon" />
            ) : (
              <AddIcon className="review-icon" />
            )}
            <span>{hoverText.watchlist && watchlistClicked ? 'Remove' : 'Watchlist'}</span>
          </div>
        </Col> */}
      </Row>
      <Row className="text-center">
        <Col>
          <Button
            variant="outline-light"
            className="addReviewButton"
            onClick={handleAddReviewClick}
          >
            Add Review
          </Button>
        </Col>
      </Row>
      {showReviewInput && (
        <ReviewInput
          movieImage={srcImg}
          title={title}
          movieId={movieId}    // Kirim movieId ke ReviewInput
          userId={userId}      // Kirim userId ke ReviewInput
          onClose={handleCloseReviewInput}
        />
      )}
    </Container>
  );
};

export default ReviewBar;